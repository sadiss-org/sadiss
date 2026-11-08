import { FIGURES } from './figures'
import { RunRecord } from './record'
import { Reading } from './thresholds'
import { read } from './verdict'

/**
 * How far a value may move the wrong way from the baseline before it counts as
 * worse: by more than `relative` of the baseline's value, and by more than
 * `absolute` in the figure's own unit, so noise on a value near zero is not a
 * regression.
 */
interface Margin {
  relative: number
  absolute: number
}

/** A time may get 10% or 5 ms worse, whichever is more. */
const TIME: Margin = { relative: 0.1, absolute: 5 }
/** A count may not grow at all. */
const COUNT: Margin = { relative: 0, absolute: 0 }

type Compared = Reading & { better: 'higher' | 'lower'; margin: Margin }

/** The values a comparison puts side by side, in the order it prints them. */
const COMPARED: readonly Compared[] = [
  { figure: 'arrivalLeadMs', statistic: 'p1', better: 'higher', margin: TIME },
  { figure: 'arrivalLeadMs', statistic: 'median', better: 'higher', margin: TIME },
  { figure: 'offsetFromMedianMs', statistic: 'p99', better: 'lower', margin: TIME },
  { figure: 'lateOffsetFromMedianMs', statistic: 'p99', better: 'lower', margin: TIME },
  { figure: 'roundTripMs', statistic: 'median', better: 'lower', margin: TIME },
  { figure: 'roundTripMs', statistic: 'p99', better: 'lower', margin: TIME },
  { figure: 'phraseLeadMs', statistic: 'p1', better: 'higher', margin: TIME },
  { figure: 'missingChunks', better: 'lower', margin: COUNT },
  { figure: 'arrivalsWithoutClock', better: 'lower', margin: COUNT },
  { figure: 'missingPhrases', better: 'lower', margin: COUNT },
  { figure: 'wrongPhrases', better: 'lower', margin: COUNT },
  { figure: 'connects', better: 'lower', margin: COUNT },
  { figure: 'dropsDuringTrack', better: 'lower', margin: COUNT },
  { figure: 'dropsBeforeTrack', better: 'lower', margin: COUNT },
  { figure: 'generatorDelayMs', statistic: 'p99', better: 'lower', margin: TIME }
]

/** How far a value moved the wrong way from the baseline, per direction. */
const WORSENING: Record<Compared['better'], (baseline: number, value: number) => number> = {
  higher: (baseline, value) => baseline - value,
  lower: (baseline, value) => value - baseline
}

const isWorse = ({ better, margin }: Compared, baseline: number | null, value: number | null) => {
  if (baseline === null || value === null) return false
  return WORSENING[better](baseline, value) > Math.max(margin.relative * Math.abs(baseline), margin.absolute)
}

export interface Comparison {
  rows: { label: string; unit: (value: number | null) => string; cells: { value: number | null; worse: boolean }[] }[]
  /** How the runs differ in what they measured, so their figures may not be comparable; empty when they match. */
  differences: string[]
}

const differ = <T>(values: T[]) => new Set(values.map((value) => JSON.stringify(value))).size > 1

/**
 * Puts runs side by side, the first as the baseline, and marks each value of
 * a later run that is worse than the baseline's beyond its margin. A value
 * either run did not measure is never marked.
 */
export const compareRuns = (records: readonly RunRecord[]): Comparison => {
  const [baseline] = records
  const rows = COMPARED.map((compared) => {
    const { label, unit } = FIGURES[compared.figure]
    const base = baseline ? read(baseline.result, compared) : null
    return {
      label: compared.statistic === undefined ? label : `${label} ${compared.statistic}`,
      unit,
      cells: records.map((record, index) => {
        const value = read(record.result, compared)
        return { value, worse: index > 0 && isWorse(compared, base, value) }
      })
    }
  })
  const differences = [
    ...(differ(records.map((record) => record.result.phones)) ? ['The runs had different numbers of phones.'] : []),
    ...(differ(records.map((record) => record.result.track)) ? ['The runs played tracks of a different shape.'] : []),
    ...(differ(records.map((record) => record.target.apiUrl)) ? ['The runs were against a different target.'] : [])
  ]
  return { rows, differences }
}
