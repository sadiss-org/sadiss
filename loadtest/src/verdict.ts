import { RunResult } from './results'
import { Reading, Threshold, thresholdsFor } from './thresholds'

export interface Verdict {
  outcome: 'pass' | 'fail' | 'invalid'
  /** One check per threshold, in the order of the thresholds. `value` is null when the run measured nothing for it. */
  checks: { threshold: Threshold; value: number | null; passed: boolean }[]
  /** The reason of every failed check whose consequence is `invalid`, in the order of the thresholds; empty unless the run is invalid. */
  invalidBecause: string[]
}

/** Whether a value meets its limit, per bound. A value equal to its limit meets it. */
const MEETS: Record<Threshold['bound'], (value: number, limit: number) => boolean> = {
  atLeast: (value, limit) => value >= limit,
  atMost: (value, limit) => value <= limit
}

/** The value of a run that a reading names, or null when the run did not measure it. */
export const read = (result: RunResult, reading: Reading): number | null => {
  const figure: unknown = result[reading.figure]
  if (reading.statistic === undefined) return typeof figure === 'number' ? figure : null
  if (typeof figure !== 'object' || figure === null) return null
  const value: unknown = Reflect.get(figure, reading.statistic)
  return typeof value === 'number' ? value : null
}

/**
 * Judges a run by its thresholds, by default those of its track. A value equal to its limit passes; a value the
 * run did not measure fails, since the run did not show that the threshold
 * holds. A run is invalid when any check whose consequence is `invalid`
 * failed, whatever the other checks say; otherwise it fails when any check
 * failed.
 */
export const judge = (result: RunResult, thresholds: readonly Threshold[] = thresholdsFor(result.track)): Verdict => {
  const checks = thresholds.map((threshold) => {
    const value = read(result, threshold)
    const passed = value !== null && MEETS[threshold.bound](value, threshold.limit)
    return { threshold, value, passed }
  })
  const failing = checks.filter((check) => !check.passed)
  const invalidBecause = failing.flatMap(({ threshold }) => (threshold.consequence === 'invalid' ? [threshold.reason] : []))
  const outcome = invalidBecause.length ? 'invalid' : failing.length ? 'fail' : 'pass'
  return { outcome, checks, invalidBecause }
}
