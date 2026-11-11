import { describe, expect, it } from 'vitest'
import { RampStep } from '../src/ramp'
import { rampEndReport, rampStepLine } from '../src/report'
import { serverFigures } from '../src/serverSampler'
import { summarize } from '../src/stats'
import { judge } from '../src/verdict'
import { RunResult } from '../src/results'

const empty = summarize([])
const step = (phones: number, spoil: (result: RunResult) => void = () => undefined): RampStep => {
  const result: RunResult = {
    phones,
    latePhones: 0,
    track: { seconds: 30, partialsPerFrame: 16, choir: false, tts: null },
    chunkCount: 30,
    arrivalLeadMs: { count: 3, min: 900, median: 950, p1: 910, p95: 960, p99: 970, max: 980 },
    arrivalsWithoutClock: 0,
    missingChunks: 0,
    connects: phones,
    dropsDuringTrack: 0,
    dropsBeforeTrack: 0,
    roundTripMs: { count: 3, min: 18, median: 24, p1: 18, p95: 40, p99: 248.87, max: 500 },
    roundTripsAtStart: empty,
    offsetFromMedianMs: { count: 3, min: 0, median: 0.2, p1: 0, p95: 0.5, p99: 0.74, max: 1 },
    lateOffsetFromMedianMs: empty,
    phraseLeadMs: empty,
    phrasesWithoutClock: 0,
    missingPhrases: 0,
    wrongPhrases: 0,
    generatorDelayMs: { p99: 0.85, max: 3 },
    ...serverFigures([])
  }
  spoil(result)
  return { phones, result, verdict: judge(result), server: { samples: [], notSampledBecause: 'not sampled in this test.' } }
}

describe('the report of a ramp', () => {
  it('shows a step on one line, with the clock round trip’s p99', () => {
    const line = rampStepLine(step(75))
    expect(line).toMatch(/^75 phones\s+PASS/)
    expect(line).toContain('p99 248.87 ms')
  })

  it('names the phones at the break, the last step that passed, and every check the break missed', () => {
    const steps = [step(25), step(50, (result) => (result.missingChunks = 4))]
    const failed = steps[1]?.verdict.checks.filter((check) => !check.passed) ?? []
    const report = rampEndReport(steps, { kind: 'break', phones: 50, failed })
    expect(report).toContain('Broke at 50 phones. The last step that passed had 25 phones. It missed:')
    expect(report).toMatch(/Missing chunks\s+4, at most 0\s+fail/)
  })

  it('says when no step passed', () => {
    expect(rampEndReport([], { kind: 'serverStoppedAnswering', phones: 25, message: 'fetch failed' })).toBe(
      'The step with 25 phones could not be run to its end: fetch failed. No step passed.'
    )
  })
})

describe('a ramp step line', () => {
  it('keeps a space between cells when a value is wider than its column', () => {
    expect(rampStepLine(step(125, (result) => (result.roundTripMs.p99 = 1618.76)))).toMatch(/1618\.76 ms\s+missing/)
  })
})
