import { RunResult } from './results'
import { Threshold, THRESHOLDS } from './thresholds'

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
