/**
 * A structured log of what happened during one performance, one JSON object per
 * line, for working out afterwards what went wrong on which phone.
 *
 * Logging must never cost the performance anything, so nothing here waits on the
 * disk. Records go into the stream's buffer; once the stream says that buffer is
 * full, further records are dropped and counted, and the count is written as a
 * record of its own when the stream has caught up.
 */

import { Writable } from 'stream'
import { logger } from '../tools'

/** Something the log records, told apart by `type`. */
export type PerformanceRecord =
  /** A device said which performance it plays, in which voice and language. */
  | {
      type: 'register'
      /** The server's id for this socket, new on every connection. */
      connection: string
      /** When the socket opened, in milliseconds on the server's clock. */
      openedAt: number
      choirId: number
      ttsLang: { iso: string; lang: string }
      protocolVersion: number
    }
  /** A registered device's socket closed: by the device or the network, or because the heartbeat gave up on it. */
  | { type: 'disconnect'; connection: string; reason: 'closed' | 'heartbeat'; code: number }
  /** An admin started a track. */
  | { type: 'start'; trackId: string; loop: boolean; startAtChunk: number }
  /** An admin stopped the track that was playing. */
  | { type: 'stop'; trackId: string }
  /** A looping track ran past its end and began again. */
  | { type: 'loop'; trackId: string }
  /** A track that does not loop ran out. */
  | { type: 'ended'; trackId: string }
  /** How many records were thrown away while the stream was backed up. */
  | { type: 'dropped'; count: number }

export interface PerformanceLog {
  /** Adds a record, stamped with the time it was written. Never waits. */
  write(record: PerformanceRecord): void
}

/** A log that keeps nothing, for when no log was asked for. */
export const noPerformanceLog: PerformanceLog = {
  write: () => undefined
}

/**
 * A log writing to `stream`. `now` is the clock the records are stamped with, in
 * milliseconds.
 *
 * A stream that fails is reported once and written to no more, so a full disk
 * takes the log down and leaves the performance alone.
 */
export const createPerformanceLog = (
  stream: Writable,
  now: () => number
): PerformanceLog & {
  /** Ends the stream. Records written afterwards are ignored. */
  close(): void
} => {
  let open = true
  let backedUp = false
  let dropped = 0

  const append = (record: PerformanceRecord) => {
    if (stream.write(JSON.stringify({ t: now(), ...record }) + '\n')) return

    backedUp = true
    stream.once('drain', catchUp)
  }

  const catchUp = () => {
    backedUp = false
    if (!open || !dropped) return

    const count = dropped
    dropped = 0
    append({ type: 'dropped', count })
  }

  stream.on('error', (err) => {
    if (open) logger.error('Performance log stopped writing:', err.message)
    open = false
  })

  return {
    write: (record) => {
      if (!open) return
      if (backedUp) {
        dropped++
        return
      }
      append(record)
    },
    close: () => {
      if (!open) return
      open = false
      stream.end()
    }
  }
}
