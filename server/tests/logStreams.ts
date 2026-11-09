import { Writable } from 'stream'
import { createRecordLog } from '../lib/recordLog'
import { PerformanceRecord } from '../lib/performanceLog'

/** Streams for testing a record log: one that never drains, one that keeps everything, one whose disk fails. */

/** A performance log writing to the one stream it is given. */
export const logTo = (stream: Writable, now: () => number = Date.now) =>
  createRecordLog<PerformanceRecord>('test.jsonl', () => stream, now)

/**
 * A stream whose buffer is always full: it takes each line it is given, says it
 * cannot take more, and only drains when the test emits `drain` itself.
 */
export class NeverDrains extends Writable {
  readonly lines: string[] = []

  write(chunk: string) {
    this.lines.push(chunk)
    return false
  }

  records() {
    return this.lines.map((line) => JSON.parse(line))
  }
}

/** A stream that takes everything at once, and never says whether it reached the disk. */
export class Keeps extends Writable {
  readonly lines: string[] = []

  write(chunk: string) {
    this.lines.push(chunk)
    return true
  }

  records() {
    return this.lines.map((line) => JSON.parse(line))
  }
}

/** A stream whose disk fails: it reports the line it could not write, then fails. */
export const failsOnWrite = () =>
  new Writable({
    write: (_chunk, _encoding, callback) => callback(new Error('EIO: i/o error, write'))
  })
