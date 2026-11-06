import { describe, expect, it } from 'vitest'
import { RunResult } from '../src/results'
import { summarize } from '../src/stats'
import { THRESHOLDS } from '../src/thresholds'
import { judge, Threshold } from '../src/verdict'

const empty = summarize([])

/** A run inside every threshold: chunks about a second early, every phone within a few ms of the median. */
const healthy = (): RunResult => ({
  phones: 10,
  track: { seconds: 20, partialsPerFrame: 16 },
  chunkCount: 20,
  arrivalLeadMs: { count: 200, min: 960, median: 980, p1: 965, p95: 984, p99: 985, max: 986 },
  arrivalsWithoutClock: 0,
  missingChunks: 0,
  connects: 10,
  drops: 0,
  roundTripMs: { count: 200, min: 1, median: 2, p1: 1, p95: 3, p99: 4, max: 5 },
  roundTripsAtStart: { count: 10, min: 20, median: 20, p1: 20, p95: 20, p99: 20, max: 20 },
  offsetFromMedianMs: { count: 300, min: 0, median: 0.5, p1: 0, p95: 1, p99: 2, max: 3 },
  generatorDelayMs: { p99: 1.5, max: 4 }
})

/** One result per threshold, just across its limit. */
const outside: [string, (result: RunResult) => void][] = [
  ['arrival lead p1', (result) => (result.arrivalLeadMs.p1 = 499)],
  ['missing chunks', (result) => (result.missingChunks = 1)],
  ['drops', (result) => (result.drops = 1)],
  ['offset from the median p99', (result) => (result.offsetFromMedianMs.p99 = 10.5)]
]

const failed = (verdict: ReturnType<typeof judge>) => verdict.checks.filter((check) => !check.passed)

describe('the verdict on a run', () => {
  it('passes a run inside every threshold, and every check passes', () => {
    const verdict = judge(healthy())
    expect(verdict.outcome).toBe('pass')
    expect(verdict.checks).toHaveLength(THRESHOLDS.length)
    expect(failed(verdict)).toEqual([])
  })

  it.each(outside)('fails a run outside the %s threshold and names it with its value and limit', (_, spoil) => {
    const result = healthy()
    spoil(result)
    const verdict = judge(result)
    expect(verdict.outcome).toBe('fail')
    const [check, ...others] = failed(verdict)
    expect(others).toEqual([])
    expect(check?.threshold.consequence).toBe('fail')
    expect(check?.value).not.toBeNull()
    expect(check?.value).not.toBe(check?.threshold.limit)
    expect(verdict.checks.filter((other) => other.passed)).toHaveLength(THRESHOLDS.length - 1)
  })

  it('names the figure, statistic, value and limit of a failing check', () => {
    const result = healthy()
    result.arrivalLeadMs.p1 = 420
    expect(failed(judge(result))).toEqual([
      {
        threshold: { figure: 'arrivalLeadMs', statistic: 'p1', bound: 'atLeast', limit: 500, consequence: 'fail' },
        value: 420,
        passed: false
      }
    ])
  })

  it('passes a value equal to its limit', () => {
    const result = healthy()
    result.arrivalLeadMs.p1 = 500
    result.offsetFromMedianMs.p99 = 10
    result.generatorDelayMs.p99 = 20
    expect(judge(result).outcome).toBe('pass')
  })

  it.each([
    ['arrivalLeadMs', 'no chunk with a clock'],
    ['offsetFromMedianMs', 'no offset sampled']
  ] as const)('fails a run with no %s figure (%s) and names that check', (figure, _measuredNothing) => {
    const result = healthy()
    result[figure] = empty
    const verdict = judge(result)
    expect(verdict.outcome).toBe('fail')
    expect(failed(verdict)).toMatchObject([{ threshold: { figure }, value: null, passed: false }])
  })

  it('calls a run invalid when the generator fell behind, though every other check passes', () => {
    const result = healthy()
    result.generatorDelayMs.p99 = 20.5
    const verdict = judge(result)
    expect(verdict.outcome).toBe('invalid')
    expect(failed(verdict)).toMatchObject([{ threshold: { figure: 'generatorDelayMs', consequence: 'invalid' }, value: 20.5 }])
  })

  it('calls a run invalid rather than failed when the generator fell behind and a check also failed', () => {
    const result = healthy()
    result.generatorDelayMs.p99 = 35
    result.drops = 3
    const verdict = judge(result)
    expect(verdict.outcome).toBe('invalid')
    expect(failed(verdict)).toHaveLength(2)
  })

  it('judges by the thresholds it is given instead of the default ones', () => {
    const strict: Threshold[] = [
      { figure: 'arrivalLeadMs', statistic: 'p1', bound: 'atLeast', limit: 970, consequence: 'fail' },
      { figure: 'connects', bound: 'atMost', limit: 10, consequence: 'fail' }
    ]
    const verdict = judge(healthy(), strict)
    expect(verdict.outcome).toBe('fail')
    expect(verdict.checks).toEqual([
      { threshold: strict[0], value: 965, passed: false },
      { threshold: strict[1], value: 10, passed: true }
    ])
  })
})
