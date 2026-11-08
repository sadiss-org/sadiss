import { describe, expect, it } from 'vitest'
import { ramp } from '../src/ramp'
import { RunResult } from '../src/results'
import { serverFigures } from '../src/serverSampler'
import { summarize } from '../src/stats'

const empty = summarize([])

/** A step's result inside every threshold, or outside the ones `spoil` breaks. */
const result = (phones: number, spoil: (result: RunResult) => void = () => undefined): RunResult => {
  const run: RunResult = {
    phones,
    latePhones: 0,
    track: { seconds: 30, partialsPerFrame: 16, choir: false, tts: null },
    chunkCount: 30,
    arrivalLeadMs: { count: 300, min: 900, median: 950, p1: 910, p95: 960, p99: 970, max: 980 },
    arrivalsWithoutClock: 0,
    missingChunks: 0,
    connects: phones,
    dropsDuringTrack: 0,
    dropsBeforeTrack: 0,
    roundTripMs: { count: 300, min: 1, median: 2, p1: 1, p95: 3, p99: 4, max: 5 },
    roundTripsAtStart: { count: phones, min: 20, median: 20, p1: 20, p95: 20, p99: 20, max: 20 },
    offsetFromMedianMs: { count: 300, min: 0, median: 0.5, p1: 0, p95: 1, p99: 2, max: 3 },
    lateOffsetFromMedianMs: empty,
    phraseLeadMs: empty,
    phrasesWithoutClock: 0,
    missingPhrases: 0,
    wrongPhrases: 0,
    generatorDelayMs: { p99: 1, max: 2 },
    ...serverFigures([])
  }
  spoil(run)
  return run
}

const notSampled = { samples: [], notSampledBecause: 'not sampled in this test.' }

/** A server that carries every room up to `carries` phones, and a step past it that `past` describes. */
const server =
  (carries: number, past: (phones: number) => Promise<{ result: RunResult; server: typeof notSampled }>) =>
  (phones: number) =>
    phones <= carries ? Promise.resolve({ result: result(phones), server: notSampled }) : past(phones)

describe('a ramp', () => {
  it('adds phones step by step until a step misses a threshold, and names the checks it missed', async () => {
    const asked: number[] = []
    const { steps, end } = await ramp({
      start: 25,
      step: 25,
      runStep: (phones) => {
        asked.push(phones)
        return server(75, (phones) => Promise.resolve({ result: result(phones, (run) => (run.arrivalLeadMs.p1 = 420)), server: notSampled }))(phones)
      },
      onStep: () => undefined,
      stopRequested: () => false
    })
    expect(asked).toEqual([25, 50, 75, 100])
    expect(steps.map((step) => [step.phones, step.verdict.outcome])).toEqual([
      [25, 'pass'],
      [50, 'pass'],
      [75, 'pass'],
      [100, 'fail']
    ])
    expect(end).toMatchObject({ kind: 'break', phones: 100, failed: [{ threshold: { figure: 'arrivalLeadMs' }, value: 420 }] })
  })

  it('ends at the step in which the server stopped answering, keeping the steps before it', async () => {
    const { steps, end } = await ramp({
      start: 10,
      step: 10,
      runStep: server(20, () => Promise.reject(new TypeError('fetch failed'))),
      onStep: () => undefined,
      stopRequested: () => false
    })
    expect(steps.map((step) => step.phones)).toEqual([10, 20])
    expect(end).toEqual({ kind: 'serverStoppedAnswering', phones: 30, message: 'fetch failed' })
  })

  it('ends as invalid, not as a break, at a step in which the generator fell behind', async () => {
    const { end } = await ramp({
      start: 25,
      step: 25,
      runStep: server(25, (phones) =>
        Promise.resolve({
          result: result(phones, (run) => {
            run.generatorDelayMs.p99 = 40
            run.missingChunks = 3
          }),
          server: notSampled
        })
      ),
      onStep: () => undefined,
      stopRequested: () => false
    })
    expect(end).toEqual({ kind: 'invalid', phones: 50, reasons: [expect.stringContaining('load generator fell behind')] })
  })

  it('tells about every step as it ends', async () => {
    const told: number[] = []
    await ramp({
      start: 5,
      step: 5,
      runStep: server(5, () => Promise.reject(new Error('down'))),
      onStep: (step) => told.push(step.phones),
      stopRequested: () => false
    })
    expect(told).toEqual([5])
  })

  it('stops after the step it is running when asked, with every step so far', async () => {
    let stop = false
    const { steps, end } = await ramp({
      start: 25,
      step: 25,
      runStep: (phones) => {
        if (phones === 50) stop = true
        return server(1000, () => Promise.reject(new Error('unused')))(phones)
      },
      onStep: () => undefined,
      stopRequested: () => stop
    })
    expect(steps.map((step) => step.phones)).toEqual([25, 50])
    expect(end).toEqual({ kind: 'stoppedByHand', phones: 50 })
  })
})
