import { describe, expect, it } from 'vitest'
import { compareRuns } from '../src/compare'
import { RunRecord } from '../src/record'
import { RunResult } from '../src/results'
import { summarize, Summary } from '../src/stats'
import { judge } from '../src/verdict'
import { serverFigures } from '../src/serverSampler'

const spread = (median: number, p1: number, p99: number): Summary => ({ count: 100, min: p1, median, p1, p95: p99, p99, max: p99 })

const result = (): RunResult => ({
  phones: 100,
  latePhones: 0,
  track: { seconds: 30, partialsPerFrame: 16, choir: false, tts: null },
  chunkCount: 30,
  arrivalLeadMs: spread(900, 700, 920),
  arrivalsWithoutClock: 0,
  missingChunks: 0,
  connects: 100,
  dropsDuringTrack: 0,
  dropsBeforeTrack: 0,
  roundTripMs: spread(24, 18, 260),
  roundTripsAtStart: spread(20, 19, 21),
  offsetFromMedianMs: spread(0.2, 0, 0.9),
  lateOffsetFromMedianMs: summarize([]),
  phraseLeadMs: summarize([]),
  phrasesWithoutClock: 0,
  missingPhrases: 0,
  wrongPhrases: 0,
  generatorDelayMs: { p99: 0.8, max: 3 },
  ...serverFigures([]),
  serverCpuPct: spread(20, 5, 60),
  serverRestarts: 0
})

const record = (change: (result: RunResult) => void = () => undefined, target = 'https://sadiss.net/capacity/server'): RunRecord => {
  const run = result()
  change(run)
  return {
    serverCommit: 'ad29734a5e80c2a0c4ffd3612b0768aa6dd71553',
    loadtestCommit: '19cd8db31fcecb865c01c91dc7d4ddffbb4ad0eb',
    target: { apiUrl: target, wsUrl: 'wss://sadiss.net/capacity/ws/' },
    runAt: '2026-11-08T19:30:00.000Z',
    generator: { cpu: 'AMD Ryzen 7 8845HS', threads: 16, node: 'v22.23.4', platform: 'linux' },
    note: null,
    result: run,
    verdict: judge(run),
    serverSamples: [],
    notSampledBecause: null
  }
}

const row = (comparison: ReturnType<typeof compareRuns>, label: string) => {
  const found = comparison.rows.find((candidate) => candidate.label === label)
  if (!found) throw new Error(`no row ${label}: ${comparison.rows.map((candidate) => candidate.label).join(', ')}`)
  return found
}

describe('comparing runs', () => {
  it('marks nothing when a run is as good as the baseline', () => {
    const comparison = compareRuns([record(), record()])
    expect(comparison.rows.flatMap((each) => each.cells).filter((cell) => cell.worse)).toEqual([])
  })

  it('marks a time worse by more than 10% of the baseline, and not one within it', () => {
    const lead = (p1: number) => row(compareRuns([record(), record((run) => (run.arrivalLeadMs.p1 = p1))]), 'Arrival before sound p1')
    expect(lead(629).cells[1]).toEqual({ value: 629, worse: true })
    expect(lead(631).cells[1]).toEqual({ value: 631, worse: false })
  })

  it('marks a small time worse only beyond 5 ms, so noise on a figure near zero is not a regression', () => {
    const offset = (p99: number) => row(compareRuns([record(), record((run) => (run.offsetFromMedianMs.p99 = p99))]), 'Clock offset off the median p99')
    expect(offset(5.8).cells[1]?.worse).toBe(false)
    expect(offset(6).cells[1]?.worse).toBe(true)
  })

  it('marks any increase of a count, and no decrease', () => {
    const missing = (count: number) => row(compareRuns([record((run) => (run.missingChunks = 2)), record((run) => (run.missingChunks = count))]), 'Missing chunks')
    expect(missing(3).cells[1]?.worse).toBe(true)
    expect(missing(1).cells[1]?.worse).toBe(false)
  })

  it('does not mark an improvement, in either direction', () => {
    const comparison = compareRuns([
      record(),
      record((run) => {
        run.arrivalLeadMs.p1 = 900
        run.roundTripMs.p99 = 30
      })
    ])
    expect(row(comparison, 'Arrival before sound p1').cells[1]?.worse).toBe(false)
    expect(row(comparison, 'Measurement round trip p99').cells[1]?.worse).toBe(false)
  })

  it('compares every run with the first, and never marks the first', () => {
    const comparison = compareRuns([record(), record((run) => (run.dropsDuringTrack = 1)), record()])
    expect(row(comparison, 'Drops during the track').cells.map((cell) => cell.worse)).toEqual([false, true, false])
  })

  it('marks nothing where either run did not measure the figure', () => {
    const comparison = compareRuns([record(), record((run) => (run.phraseLeadMs = spread(1400, 1300, 1500)))])
    expect(row(comparison, 'Phrase before its time p1').cells).toEqual([
      { value: null, worse: false },
      { value: 1300, worse: false }
    ])
  })

  it('marks the server using more CPU beyond the margin, and a restart', () => {
    const comparison = compareRuns([record(), record((run) => ((run.serverCpuPct.p95 = 67), (run.serverRestarts = 1)))])
    expect(row(comparison, 'Server CPU of one core p95').cells[1]?.worse).toBe(true)
    expect(row(comparison, 'Server restarts').cells[1]?.worse).toBe(true)
  })

  it('marks nothing about the server when a run did not sample it', () => {
    const comparison = compareRuns([record(), record((run) => Object.assign(run, serverFigures([])))])
    expect(row(comparison, 'Server restarts').cells[1]).toEqual({ value: null, worse: false })
  })

  it('warns when the runs differ in phones, track or target, which makes their figures hard to compare', () => {
    const comparison = compareRuns([
      record(),
      record((run) => {
        run.phones = 300
        run.track = { ...run.track, choir: true, partialsPerFrame: 4 }
      }, 'http://127.0.0.1:3000')
    ])
    expect(comparison.differences).toEqual([
      expect.stringContaining('phones'),
      expect.stringContaining('track'),
      expect.stringContaining('target')
    ])
    expect(compareRuns([record(), record()]).differences).toEqual([])
  })
})
