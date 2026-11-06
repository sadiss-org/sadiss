import { RunResult } from './results'
import { THRESHOLDS } from './thresholds'

/** The fields of an object that hold a number, or a number the run may not have measured. */
type NumberFields<T> = { [K in keyof T]-?: T[K] extends number | null ? K : never }[keyof T]

/** A value a threshold can read from a figure that holds several, such as `p1` for the 1st percentile or `median`. */
export type Statistic = {
  [F in keyof RunResult]: RunResult[F] extends number ? never : NumberFields<RunResult[F]>
}[keyof RunResult]

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

export interface Verdict {
  outcome: 'pass' | 'fail' | 'invalid'
  /** One check per threshold, in the order of the thresholds. `value` is null when the run measured nothing for it. */
  checks: { threshold: Threshold; value: number | null; passed: boolean }[]
}

const read = (result: RunResult, threshold: Threshold): number | null => {
  const figure: unknown = result[threshold.figure]
  if (threshold.statistic === undefined) return typeof figure === 'number' ? figure : null
  if (typeof figure !== 'object' || figure === null) return null
  const value: unknown = Reflect.get(figure, threshold.statistic)
  return typeof value === 'number' ? value : null
}

/**
 * Judges a run by its thresholds. A value equal to its limit passes; a value the
 * run did not measure fails, since the run did not show that the threshold
 * holds. A run is invalid when any check whose consequence is `invalid`
 * failed, whatever the other checks say; otherwise it fails when any check
 * failed.
 */
export const judge = (result: RunResult, thresholds: readonly Threshold[] = THRESHOLDS): Verdict => {
  const checks = thresholds.map((threshold) => {
    const value = read(result, threshold)
    const passed = value !== null && (threshold.bound === 'atLeast' ? value >= threshold.limit : value <= threshold.limit)
    return { threshold, value, passed }
  })
  const failing = checks.filter((check) => !check.passed)
  const outcome = failing.some((check) => check.threshold.consequence === 'invalid')
    ? 'invalid'
    : failing.length
      ? 'fail'
      : 'pass'
  return { outcome, checks }
}
