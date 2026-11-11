export interface Summary {
  count: number
  min: number | null
  median: number | null
  p1: number | null
  p95: number | null
  p99: number | null
  max: number | null
}

/** Linear interpolation between the closest ranks, as most statistics tools do. */
const percentile = (sorted: number[], p: number) => {
  const rank = p * (sorted.length - 1)
  const below = Math.floor(rank)
  const lower = sorted[below] ?? Number.NaN
  const upper = sorted[Math.min(below + 1, sorted.length - 1)] ?? lower
  return Number((lower + (upper - lower) * (rank - below)).toFixed(6))
}

export const summarize = (values: number[]): Summary => {
  if (!values.length) return { count: 0, min: null, median: null, p1: null, p95: null, p99: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    median: percentile(sorted, 0.5),
    p1: percentile(sorted, 0.01),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null
  }
}

/** The fewest phones with a clock offset that have a median to be measured against. */
export const MIN_PHONES = 2

/**
 * How far each phone's clock offset is from the median offset of all phones at
 * one moment, in ms. All virtual phones of a run share one physical clock, so a
 * perfect clock sync would give them identical offsets, and each distance is
 * that phone's share of the sync's error. Unlike the highest minus the lowest
 * offset, these distances do not grow just because there are more phones.
 * Phones without an estimate yet are left out.
 *
 * `others` are measured against the same median without moving it, such as
 * phones whose clocks have not settled yet; their distances come back apart.
 */
export const distancesFromMedian = (offsets: (number | null)[], others: (number | null)[] = []) => {
  const isKnown = (offset: number | null): offset is number => offset !== null
  const known = offsets.filter(isKnown)
  if (known.length < MIN_PHONES) return { distances: [], others: [] }
  const median = summarize(known).median ?? 0
  const from = (values: number[]) => values.map((offset) => Math.abs(offset - median))
  return { distances: from(known), others: from(others.filter(isKnown)) }
}
