import fs from 'fs'
import path from 'path'
import { createPerformanceLog, PerformanceLog, PerformanceRecord } from '../lib/performanceLog'
import { logger } from '../tools'

/**
 * The application-wide performance logs: one JSON-lines file per performance,
 * `performance-<id>.jsonl` in the directory `PERFORMANCE_LOG_DIR` names. Nothing
 * is written when it is unset. The directory can be changed at runtime with
 * `performanceLogs.writeTo(...)`.
 *
 * A file is opened by the first record for its performance and closed after ten
 * minutes without one, so a performance that is over lets go of its file without
 * anyone having to say it is over. A later record opens it again and appends.
 */

const IDLE_MS = 10 * 60 * 1000

/** How often open files are checked for having gone idle. */
const SWEEP_MS = 60 * 1000

interface OpenFile {
  log: PerformanceLog
  lastWrittenAt: number
}

const createPerformanceLogs = (initialDir: string | null) => {
  let dir = initialDir
  /** Whether `dir` has been created. Reset when the directory changes. */
  let dirReady = false
  const open = new Map<string, OpenFile>()
  let sweeper: NodeJS.Timeout | undefined

  const closeFile = (key: string) => {
    open.get(key)?.log.close()
    open.delete(key)
    if (!open.size && sweeper) {
      clearInterval(sweeper)
      sweeper = undefined
    }
  }

  const closeIdleFiles = () => {
    const now = Date.now()
    for (const [key, file] of open) {
      if (now - file.lastWrittenAt >= IDLE_MS) closeFile(key)
    }
  }

  /** The open file for a performance, opening it if needed. Undefined when there is nowhere to write. */
  const fileFor = (key: string, logDir: string) => {
    const existing = open.get(key)
    if (existing) return existing

    if (!dirReady) {
      try {
        fs.mkdirSync(logDir, { recursive: true })
        dirReady = true
      } catch (err) {
        logger.error(`Performance logs are off: cannot create ${logDir}:`, err instanceof Error ? err.message : err)
        dir = null
        return undefined
      }
    }

    // A performance id comes off the wire, so it may not name a path of its own.
    const safeId = key.replace(/[^A-Za-z0-9_-]/g, '_')
    const stream = fs.createWriteStream(path.join(logDir, `performance-${safeId}.jsonl`), { flags: 'a' })
    const file = { log: createPerformanceLog(stream, Date.now), lastWrittenAt: Date.now() }
    open.set(key, file)

    if (!sweeper) {
      sweeper = setInterval(closeIdleFiles, SWEEP_MS)
      // Don't let an open log alone keep the process alive.
      sweeper.unref()
    }

    return file
  }

  const write = (key: string, record: PerformanceRecord) => {
    if (!dir) return
    const file = fileFor(key, dir)
    if (!file) return
    file.lastWrittenAt = Date.now()
    file.log.write(record)
  }

  return {
    /**
     * The log for one performance. It can be held for as long as the caller
     * likes: each record goes to whatever file is open for the performance when
     * it is written.
     */
    for: (performanceKey: string): PerformanceLog => ({
      write: (record) => write(performanceKey, record),
      close: () => closeFile(performanceKey)
    }),

    /** Closes every open file and writes from now on to `newDir`, or nowhere when it is null. */
    writeTo: (newDir: string | null) => {
      for (const key of Array.from(open.keys())) closeFile(key)
      dir = newDir
      dirReady = false
    }
  }
}

export const performanceLogs = createPerformanceLogs(process.env.PERFORMANCE_LOG_DIR || null)
