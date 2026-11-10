import fs from 'fs'
import path from 'path'
import { PerformanceLog, PerformanceRecord, ServerLog, ServerRecord } from '../lib/logRecords'
import { createRecordLog } from '../lib/recordLog'
import { logger, reasonOf } from '../tools'

/**
 * The application-wide log files, in the directory `PERFORMANCE_LOG_DIR` names:
 * `performance-<id>.jsonl` for each performance, and `server.jsonl` for what
 * happens to a connection while it belongs to none. Nothing is written when it
 * is unset. Tests point it at a directory of their own with
 * `performanceLogFiles.writeTo(...)`.
 *
 * A file is opened by its first record and closed after ten minutes without one,
 * so a performance that is over lets go of its file without anyone having to say
 * it is over. A later record opens it again and appends. A file stays open while
 * it has lines not yet known to be written, so a count of lost lines it still
 * owes is not thrown away.
 *
 * Each file is a record log (lib/recordLog.ts), which tries a file that could
 * not be written again a minute later and counts what it lost meanwhile. Here
 * the directory is made again before that next try, in case it was removed,
 * without waiting on the disk: a record can be written from the playback step.
 */

const IDLE_MS = 10 * 60 * 1000

/** How often files are checked for having gone idle. */
const SWEEP_MS = 60 * 1000

type AnyRecord = PerformanceRecord | ServerRecord

interface LogFile {
  log: ReturnType<typeof createRecordLog<AnyRecord>>
  lastWrittenAt: number
}

const createPerformanceLogFiles = (initialDir: string | null) => {
  let dir: string | null = null
  const files = new Map<string, LogFile>()
  let sweeper: NodeJS.Timeout | undefined

  /**
   * Creates the directory as soon as it is set, so the first record does not
   * wait on the disk to do it, and a directory that cannot be made is reported
   * at once.
   */
  const useDir = (newDir: string | null) => {
    dir = newDir
    if (!newDir) return

    try {
      fs.mkdirSync(newDir, { recursive: true })
    } catch (err) {
      logger.error(`Performance logs cannot create ${newDir} (${reasonOf(err)}), each file tries again when it is written`)
    }
  }

  /** Opens a file for appending. */
  const opener = (fileDir: string, name: string) => () => fs.createWriteStream(path.join(fileDir, name), { flags: 'a' })

  /** Makes the directory again before a file that failed is tried again. If it cannot, opening the file says why. */
  const remakeDir = (fileDir: string) => () =>
    fs.promises.mkdir(fileDir, { recursive: true }).then(
      () => undefined,
      () => undefined
    )

  const closeFile = (name: string) => {
    files.get(name)?.log.close()
    files.delete(name)
    if (!files.size && sweeper) {
      clearInterval(sweeper)
      sweeper = undefined
    }
  }

  const sweep = () => {
    const now = Date.now()
    for (const [name, file] of files) {
      if (now - file.lastWrittenAt >= IDLE_MS && !file.log.unsettled) closeFile(name)
    }
  }

  const write = (name: string, record: AnyRecord) => {
    if (!dir) return

    let file = files.get(name)
    if (!file) {
      file = { log: createRecordLog<AnyRecord>(name, opener(dir, name), Date.now, remakeDir(dir)), lastWrittenAt: 0 }
      files.set(name, file)
    }
    file.lastWrittenAt = Date.now()

    if (!sweeper) {
      sweeper = setInterval(sweep, SWEEP_MS)
      // Don't let an open log alone keep the process alive.
      sweeper.unref()
    }

    file.log.write(record)
  }

  const server: ServerLog = { write: (record) => write('server.jsonl', record) }

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

    /** The server-wide log, of connections that belong to no performance. */
    server,

    /** Closes every open file and writes from now on to `newDir`, or nowhere when it is null. */
    writeTo: (newDir: string | null) => {
      for (const name of Array.from(files.keys())) closeFile(name)
      useDir(newDir)
    }
  }
}

export const performanceLogFiles = createPerformanceLogFiles(process.env.PERFORMANCE_LOG_DIR || null)
