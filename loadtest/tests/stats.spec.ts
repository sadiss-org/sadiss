import { describe, expect, it } from 'vitest'
import { distancesFromMedian, MIN_PHONES, summarize } from '../src/stats'

describe('a summary of measured values', () => {
  it('gives the median, the 1st, 95th and 99th percentile and the extremes', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(summarize(values)).toEqual({ count: 100, min: 1, median: 50.5, p1: 1.99, p95: 95.05, p99: 99.01, max: 100 })
  })

  it('is empty for no values', () => {
    expect(summarize([])).toEqual({ count: 0, min: null, median: null, p1: null, p95: null, p99: null, max: null })
  })
})

describe('how far each phone’s clock offset is from the median of all phones', () => {
  it('is each offset’s distance from the median', () => {
    expect(distancesFromMedian([1000, 1002, 1007])).toEqual([2, 0, 5])
  })

  it('leaves out phones that have no offset yet', () => {
    expect(distancesFromMedian([null, 1000, 1004])).toEqual([2, 2])
  })

  it('is empty with fewer than the minimum of phones that have an offset, and is not at the minimum', () => {
    const offsets = (n: number) => Array.from({ length: n }, (_, i) => 1000 + i)
    expect(distancesFromMedian([null, ...offsets(MIN_PHONES - 1)])).toEqual([])
    expect(distancesFromMedian([null, ...offsets(MIN_PHONES)])).toHaveLength(MIN_PHONES)
  })

  it('does not grow with the number of phones when every phone is as far off as before', () => {
    const few = [999, 1001]
    const many = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1001 : 999))
    expect(summarize(distancesFromMedian(many)).p99).toBe(summarize(distancesFromMedian(few)).p99)
  })
})
