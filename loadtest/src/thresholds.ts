import { RunResult } from './results'

/** The fields of an object that hold a number, or a number the run may not have measured. */
type NumberFields<T> = { [K in keyof T]-?: T[K] extends number | null ? K : never }[keyof T]

/**
 * Which value of a run a threshold reads: a figure that is a plain number, or
 * one statistic of a figure that holds several.
 */
type Reading = {
  [F in keyof RunResult]: RunResult[F] extends number
    ? { figure: F; statistic?: undefined }
    : { figure: F; statistic: NumberFields<RunResult[F]> }
}[keyof RunResult]

/**
 * One rule a run is judged by. A run whose value is on the wrong side of the
 * limit fails the check; its consequence says whether that makes the run fail
 * or makes it invalid, which means the load generator, not the server, fell
 * behind and the run says nothing about the server.
 */
export type Threshold = Reading & {
  bound: 'atLeast' | 'atMost'
  limit: number
  consequence: 'fail' | 'invalid'
}

/** What a run must meet to pass, at 100 phones as at 300. */
export const THRESHOLDS: readonly Threshold[] = [
  // 99% of chunks reach their phone at least 500 ms before they have to sound.
  { figure: 'arrivalLeadMs', statistic: 'p1', bound: 'atLeast', limit: 500, consequence: 'fail' },
  // Every phone receives every chunk of the track.
  { figure: 'missingChunks', bound: 'atMost', limit: 0, consequence: 'fail' },
  // No phone loses its connection while the track plays. Drops before the track, while the
  // phones join and settle, are reported on their own and have no threshold.
  { figure: 'drops', bound: 'atMost', limit: 0, consequence: 'fail' },
  // 99% of the sampled clock offsets are within 10 ms of the median of all phones.
  { figure: 'offsetFromMedianMs', statistic: 'p99', bound: 'atMost', limit: 10, consequence: 'fail' },
  // The load generator's own event loop fell behind by at most 20 ms at the 99th percentile;
  // beyond that the generator, not the server, was too slow, and the run says nothing about the server.
  { figure: 'generatorDelayMs', statistic: 'p99', bound: 'atMost', limit: 20, consequence: 'invalid' }
]
