/**
 * A log of records, one JSON object per line, written to a file for as long as
 * the file lives: it opens the file, tries again a minute after it could not,
 * and counts every line that never reached it.
 *
 * Logging must never cost the work it records anything, so nothing here waits
 * on the disk. Lines go into the stream's buffer; once the stream says that
 * buffer is full, further records are dropped. A line counts as written only
 * once the stream confirms it, so the lines still in the buffer when the stream
 * fails are lost too. Every lost line is counted, and the count is written as a
 * `dropped` record of its own as soon as a stream takes lines again.
 */

import { Writable } from 'stream'
import { logger, reasonOf } from '../tools'

/** How long a log whose stream could not be opened or failed waits before it opens another. */
const RETRY_MS = 60 * 1000

/** How many lines were lost before this one, because they could not be written. */
export type DroppedRecord = { type: 'dropped'; count: number }

export interface RecordLog<R extends { type: string }> {
  /** Adds a record, stamped with the time it was written. Never waits. */
  write(record: R): void
}

/** One stream a log opened, with what it has been given and not yet confirmed. */
interface Target {
  stream: Writable
  /** Whether the stream said its buffer is full and has not drained since. */
  backedUp: boolean
  /** How many lines it was given that it has not yet confirmed writing. */
  unconfirmed: number
  /** Whether it failed or was closed, after which what it confirms is no longer counted. */
  done: boolean
}

/**
 * A log named `name` in console messages, writing to the streams `open` gives
 * it. `open` is called for the first record, and again after a stream could not
 * be opened or failed; it may throw, which counts as a failure. Before that next
 * try, once the minute is over, `prepareRetry` makes again whatever the stream
 * needs, such as its directory. It works in the background, and records written
 * until it settles are counted as lost. `now` is the clock the records are
 * stamped with, in milliseconds.
 */
export const createRecordLog = <R extends { type: string }>(
  name: string,
  open: () => Writable,
  now: () => number,
  prepareRetry: () => Promise<void> = () => Promise.resolve()
): RecordLog<R> & {
  /**
   * Ends the stream, after writing how many lines were lost when a stream is
   * open. A log closed while it waits to try a failed file again has none, and
   * that count is not written. Records written afterwards are ignored.
   */
  close(): void
  /**
   * How many lines are not yet known to be in the file: lost and not yet
   * written in a `dropped` record, or given to the stream and not yet confirmed.
   */
  readonly unsettled: number
} => {
  let current: Target | undefined
  let closed = false
  let lost = 0
  /** Whether a failure is being waited out, after which another stream may be opened. */
  let retrying = false
  let retryTimer: NodeJS.Timeout | undefined

  const fail = (reason: string) => {
    logger.error(`Log ${name} ${reason}, trying again in a minute`)
    retrying = true
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void prepareRetry().then(() => {
        retrying = false
        // Opened at once only to say how many lines were lost. Otherwise the next record opens it.
        if (lost && !closed) openStream()
      })
    }, RETRY_MS)
    // Don't let a log alone keep the process alive.
    retryTimer.unref()
  }

  const append = (target: Target, record: R | DroppedRecord, lines: number) => {
    target.unconfirmed += lines
    const more = target.stream.write(JSON.stringify({ t: now(), ...record }) + '\n', (err) => {
      if (target.done) return
      target.unconfirmed -= lines
      if (err) lost += lines
    })
    if (!more) target.backedUp = true
  }

  /** Writes the count of lost lines, if there is one and the stream can take it. A `dropped` line that is lost carries its count back. */
  const reportLost = (target: Target) => {
    if (!lost || target.backedUp) return
    const count = lost
    lost = 0
    append(target, { type: 'dropped', count }, count)
  }

  const openStream = () => {
    let stream: Writable
    try {
      stream = open()
    } catch (err) {
      fail(`cannot be opened (${reasonOf(err)})`)
      return
    }

    const target: Target = { stream, backedUp: false, unconfirmed: 0, done: false }
    current = target

    stream.on('error', (err) => {
      if (target.done) return
      target.done = true
      current = undefined
      lost += target.unconfirmed
      fail(`stopped writing (${reasonOf(err)})`)
    })
    stream.on('drain', () => {
      if (target.done) return
      target.backedUp = false
      reportLost(target)
    })

    reportLost(target)
  }

  return {
    write: (record) => {
      if (closed) return
      if (!current && !retrying) openStream()
      if (!current || current.backedUp) {
        lost++
        return
      }
      reportLost(current)
      append(current, record, 1)
    },
    close: () => {
      if (closed) return
      closed = true
      clearTimeout(retryTimer)
      retryTimer = undefined
      if (!current) return

      const target = current
      current = undefined
      // The stream buffers what it is given past its limit; ending is the last chance to say what was lost.
      target.backedUp = false
      reportLost(target)
      target.done = true
      target.stream.end()
    },
    get unsettled() {
      return lost + (current?.unconfirmed ?? 0)
    }
  }
}
