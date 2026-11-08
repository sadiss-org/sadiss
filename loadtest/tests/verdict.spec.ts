import { describe, expect, it } from 'vitest'
import { RunResult } from '../src/results'
import { summarize } from '../src/stats'
import { PHRASE_THRESHOLDS, Threshold, THRESHOLDS } from '../src/thresholds'
import { judge } from '../src/verdict'
import { serverFigures } from '../src/serverSampler'

const empty = summarize([])

/** A run inside every threshold: chunks about a second early, every phone within a few ms of the median. */
const healthy = (): RunResult => ({
  phones: 10,
  latePhones: 0,
  track: { seconds: 20, partialsPerFrame: 16, choir: false, tts: null },
  chunkCount: 20,
  arrivalLeadMs: { count: 200, min: 960, median: 980, p1: 965, p95: 984, p99: 985, max: 986 },
  arrivalsWithoutClock: 0,
  missingChunks: 0,
  connects: 10,
  dropsDuringTrack: 0,
  dropsBeforeTrack: 0,
  roundTripMs: { count: 200, min: 1, median: 2, p1: 1, p95: 3, p99: 4, max: 5 },
  roundTripsAtStart: { count: 10, min: 20, median: 20, p1: 20, p95: 20, p99: 20, max: 20 },
  offsetFromMedianMs: { count: 300, min: 0, median: 0.5, p1: 0, p95: 1, p99: 2, max: 3 },
  lateOffsetFromMedianMs: empty,
  phraseLeadMs: empty,
  phrasesWithoutClock: 0,
  missingPhrases: 0,
  wrongPhrases: 0,
  generatorDelayMs: { p99: 1.5, max: 4 },
  ...serverFigures([])
})

/** One result per threshold, just across its limit, with the figure the failing check must name. */
const outside: [string, keyof RunResult, (result: RunResult) => void][] = [
  ['arrival lead p1', 'arrivalLeadMs', (result) => (result.arrivalLeadMs.p1 = 499)],
  ['missing chunks', 'missingChunks', (result) => (result.missingChunks = 1)],
  ['drops during the track', 'dropsDuringTrack', (result) => (result.dropsDuringTrack = 1)],
  ['offset from the median p99', 'offsetFromMedianMs', (result) => (result.offsetFromMedianMs.p99 = 10.5)]
]

/** A run of a track with phrases inside every threshold, phrases included. */
const healthyWithPhrases = (): RunResult => ({
  ...healthy(),
  track: { seconds: 20, partialsPerFrame: 4, choir: true, tts: { langs: ['en-US'], everySeconds: 4 } },
  phraseLeadMs: { count: 50, min: 1400, median: 1450, p1: 1410, p95: 1480, p99: 1490, max: 1495 }
})

const outsidePhrases: [string, keyof RunResult, (result: RunResult) => void][] = [
  ['phrase lead p1', 'phraseLeadMs', (result) => (result.phraseLeadMs.p1 = 499)],
  ['missing phrases', 'missingPhrases', (result) => (result.missingPhrases = 1)],
  ['wrong phrases', 'wrongPhrases', (result) => (result.wrongPhrases = 1)]
]

const failed = (verdict: ReturnType<typeof judge>) => verdict.checks.filter((check) => !check.passed)

describe('the verdict on a run', () => {
  it('passes a run inside every threshold, and every check passes', () => {
    const verdict = judge(healthy())
    expect(verdict.outcome).toBe('pass')
    expect(verdict.checks).toHaveLength(THRESHOLDS.length)
    expect(failed(verdict)).toEqual([])
    expect(verdict.invalidBecause).toEqual([])
  })

  it.each(outside)('fails a run outside the %s threshold and names it with its value and limit', (_, figure, spoil) => {
    const result = healthy()
    spoil(result)
    const verdict = judge(result)
    expect(verdict.outcome).toBe('fail')
    const [check, ...others] = failed(verdict)
    expect(others).toEqual([])
    expect(check?.threshold.figure).toBe(figure)
    expect(check?.threshold.consequence).toBe('fail')
    expect(check?.value).not.toBeNull()
    expect(check?.value).not.toBe(check?.threshold.limit)
    expect(verdict.checks.filter((other) => other.passed)).toHaveLength(THRESHOLDS.length - 1)
  })

  it('judges a track without phrases by no phrase threshold, so a run without phrases can pass', () => {
    expect(judge(healthy()).checks.map((check) => check.threshold)).toEqual(THRESHOLDS)
  })

  it('judges a track with phrases by the phrase thresholds as well, and passes it when they hold', () => {
    const verdict = judge(healthyWithPhrases())
    expect(verdict.outcome).toBe('pass')
    expect(verdict.checks.map((check) => check.threshold)).toEqual([...THRESHOLDS, ...PHRASE_THRESHOLDS])
  })

  it.each(outsidePhrases)('fails a run with phrases outside the %s threshold and names it', (_, figure, spoil) => {
    const result = healthyWithPhrases()
    spoil(result)
    const verdict = judge(result)
    expect(verdict.outcome).toBe('fail')
    expect(failed(verdict)).toMatchObject([{ threshold: { figure, consequence: 'fail' } }])
  })

  it('fails a run with phrases in which no phrase reached a phone with a clock', () => {
    const result = healthyWithPhrases()
    result.phraseLeadMs = empty
    expect(failed(judge(result))).toMatchObject([{ threshold: { figure: 'phraseLeadMs' }, value: null }])
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
    result.dropsDuringTrack = 3
    const verdict = judge(result)
    expect(verdict.outcome).toBe('invalid')
    expect(failed(verdict)).toHaveLength(2)
  })

  it('judges by the thresholds it is given instead of the default ones', () => {
    const strict: Threshold[] = [
      { figure: 'arrivalLeadMs', statistic: 'p1', bound: 'atLeast', limit: 970, consequence: 'fail' },
      { figure: 'connects', bound: 'atMost', limit: 10, consequence: 'fail' },
      { figure: 'roundTripMs', statistic: 'median', bound: 'atMost', limit: 2, consequence: 'fail' },
      { figure: 'generatorDelayMs', statistic: 'max', bound: 'atMost', limit: 3, consequence: 'invalid', reason: 'the generator stalled.' }
    ]
    const verdict = judge(healthy(), strict)
    expect(verdict.outcome).toBe('invalid')
    expect(verdict.checks).toEqual([
      { threshold: strict[0], value: 965, passed: false },
      { threshold: strict[1], value: 10, passed: true },
      { threshold: strict[2], value: 2, passed: true },
      { threshold: strict[3], value: 4, passed: false }
    ])
  })

  it('says why a run is invalid by the reason of each failed invalid check, and only of those', () => {
    const thresholds: Threshold[] = [
      { figure: 'connects', bound: 'atMost', limit: 1, consequence: 'fail' },
      { figure: 'phones', bound: 'atLeast', limit: 100, consequence: 'invalid', reason: 'too few phones joined.' },
      { figure: 'generatorDelayMs', statistic: 'p99', bound: 'atMost', limit: 20, consequence: 'invalid', reason: 'the generator fell behind.' }
    ]
    const verdict = judge(healthy(), thresholds)
    expect(verdict.outcome).toBe('invalid')
    expect(verdict.invalidBecause).toEqual(['too few phones joined.'])
  })
})
