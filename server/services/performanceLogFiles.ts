import fs from 'fs'
import path from 'path'
import { createPerformanceLog, PerformanceLog, PerformanceRecord, ServerRecord } from '../lib/performanceLog'
import { logger } from '../tools'

/**
 * The application-wide log files, in the directory `PERFORMANCE_LOG_DIR` names:
 * `performance-<id>.jsonl` for each performance, and `server.jsonl` for what
 * happens to a connection before it belongs to one. Nothing is written when it
 * is unset. The directory can be changed at runtime with
 * `performanceLogFiles.writeTo(...)`.
 *
 * A file is opened by its first record and closed after ten minutes without one,
 * so a performance that is over lets go of its file without anyone having to say
 * it is over. A later record opens it again and appends.
 *
 * A file that cannot be written, because its stream failed or the directory
 * could not be created, is tried again a minute later. Records arriving
 * meanwhile are dropped and counted, and the first line written once it works
 * again is a `dropped` record with that count.
 */

const IDLE_MS = 10 * 60 * 1000

/** How long a file that could not be written is left alone before it is tried again. */
const RETRY_MS = 60 * 1000

/** How often files are checked for having gone idle, or for being due another try. */
const SWEEP_MS = 60 * 1000

type AnyRecord = PerformanceRecord | ServerRecord

interface LogFile {
  /** The writer, while the file is open and has not failed. */
  log?: ReturnType<typeof createPerformanceLog<AnyRecord>>
  lastWrittenAt: number
  /** When a file that could not be written may be opened again. */
  retryAt: number
  /** Records thrown away since the file stopped working, still to be written as one `dropped` record. */
  dropped: number
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : err)

const createPerformanceLogFiles = (initialDir: string | null) => {
  let dir: string | null = null
  /** Whether `dir` exists. While it does not, records are dropped and counted. */
  let dirReady = false
  let dirRetryAt = 0
  let creatingDir = false
  const files = new Map<string, LogFile>()
  let sweeper: NodeJS.Timeout | undefined

  const dirFailed = (failedDir: string, err: unknown) => {
    logger.error(`Performance logs cannot create ${failedDir}, trying again in a minute:`, reasonOf(err))
    dirRetryAt = Date.now() + RETRY_MS
  }

  /**
   * Creates the directory as soon as it is set, so the first record does not
   * wait on the disk to do it.
   */
  const useDir = (newDir: string | null) => {
    dir = newDir
    dirReady = false
    dirRetryAt = 0
    creatingDir = false
    if (!newDir) return

    try {
      fs.mkdirSync(newDir, { recursive: true })
      dirReady = true
    } catch (err) {
      dirFailed(newDir, err)
    }
  }

  /** Tries creating the directory again once that is due, without waiting for it. */
  const retryDir = () => {
    if (!dir || creatingDir || Date.now() < dirRetryAt) return

    const retried = dir
    creatingDir = true
    fs.promises.mkdir(retried, { recursive: true }).then(
      () => {
        if (dir !== retried) return
        creatingDir = false
        dirReady = true
        for (const [name, file] of files) if (file.dropped) openIfDue(name, file)
      },
      (err) => {
        if (dir !== retried) return
        creatingDir = false
        dirFailed(retried, err)
      }
    )
  }

  /**
   * The working writer for a file, opening it when that is due. Undefined while
   * the file cannot be written. A file reopened after a failure first says how
   * many records it missed; the count is let go of once the file has opened, so
   * a reopen that fails again keeps it for the next one.
   */
  const openIfDue = (name: string, file: LogFile) => {
    if (file.log?.failed) {
      file.log = undefined
      file.retryAt = Date.now() + RETRY_MS
    }
    if (file.log) return file.log

    if (!dir || !dirReady) {
      retryDir()
      return undefined
    }
    if (Date.now() < file.retryAt) return undefined

    const stream = fs.createWriteStream(path.join(dir, name), { flags: 'a' })
    const log = createPerformanceLog<AnyRecord>(stream, Date.now)
    file.log = log

    const missed = file.dropped
    if (missed) {
      log.write({ type: 'dropped', count: missed })
      stream.once('open', () => (file.dropped -= missed))
    }

    return log
  }

  const closeFile = (name: string) => {
    files.get(name)?.log?.close()
    files.delete(name)
    if (!files.size && sweeper) {
      clearInterval(sweeper)
      sweeper = undefined
    }
  }

  const sweep = () => {
    const now = Date.now()
    for (const [name, file] of files) {
      if (file.dropped) openIfDue(name, file)
      if (now - file.lastWrittenAt >= IDLE_MS) closeFile(name)
    }
  }

  const write = (name: string, record: AnyRecord) => {
    if (!dir) return

    let file = files.get(name)
    if (!file) {
      file = { lastWrittenAt: 0, retryAt: 0, dropped: 0 }
      files.set(name, file)
    }
    file.lastWrittenAt = Date.now()

    if (!sweeper) {
      sweeper = setInterval(sweep, SWEEP_MS)
      // Don't let an open log alone keep the process alive.
      sweeper.unref()
    }

    const log = openIfDue(name, file)
    if (log) log.write(record)
    else file.dropped++
  }

  const server: PerformanceLog<ServerRecord> = { write: (record) => write('server.jsonl', record) }

  useDir(initialDir)

  return {
    /**
     * The log for one performance. It can be held for as long as the caller
     * likes: each record goes to whatever file is open for the performance when
     * it is written. The id is trusted to name a performance that exists.
     */
    for: (performanceId: string): PerformanceLog => {
      // Kept to a file name of its own whatever the id holds.
      const name = `performance-${performanceId.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`
      return { write: (record) => write(name, record) }
    },

    /** The server-wide log, of connections that do not belong to a performance yet. */
    server,

    /** Closes every open file and writes from now on to `newDir`, or nowhere when it is null. */
    writeTo: (newDir: string | null) => {
      for (const name of Array.from(files.keys())) closeFile(name)
      useDir(newDir)
    }
  }
}

export const performanceLogFiles = createPerformanceLogFiles(process.env.PERFORMANCE_LOG_DIR || null)
