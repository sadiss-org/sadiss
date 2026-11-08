import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readRecord, recordFileName, writeRecord } from '../src/record'
import { RunResult } from '../src/results'
import { summarize } from '../src/stats'
import { judge } from '../src/verdict'

const empty = summarize([])
const run: RunResult = {
  phones: 100,
  latePhones: 10,
  track: { seconds: 30, partialsPerFrame: 16, choir: false, tts: null },
  chunkCount: 30,
  arrivalLeadMs: summarize([900, 910]),
  arrivalsWithoutClock: 0,
  missingChunks: 0,
  connects: 100,
  dropsDuringTrack: 0,
  dropsBeforeTrack: 0,
  roundTripMs: summarize([20, 30]),
  roundTripsAtStart: summarize([20, 20]),
  offsetFromMedianMs: summarize([0.1, 0.2]),
  lateOffsetFromMedianMs: empty,
  phraseLeadMs: empty,
  phrasesWithoutClock: 0,
  missingPhrases: 0,
  wrongPhrases: 0,
  generatorDelayMs: { p99: 0.8, max: 3 }
}

const record = {
  serverCommit: 'ad29734a5e80c2a0c4ffd3612b0768aa6dd71553',
  loadtestCommit: null,
  target: { apiUrl: 'https://sadiss.net/capacity/server', wsUrl: 'wss://sadiss.net/capacity/ws/' },
  runAt: '2026-11-08T19:30:12.345Z',
  generator: { cpu: 'AMD Ryzen 7 8845HS', threads: 16, node: 'v22.23.4', platform: 'linux' },
  note: 'live instance idle',
  result: run,
  verdict: judge(run)
}

describe('the results file of a run', () => {
  const folder = mkdtempSync(join(tmpdir(), 'loadtest-results-'))
  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('is named by when the run started, in UTC, the target and the number of phones', () => {
    expect(recordFileName(record)).toBe('2026-11-08T1930Z-sadiss.net-capacity-server-100p.json')
    expect(recordFileName({ ...record, target: { ...record.target, apiUrl: 'http://127.0.0.1:3000' } })).toBe('2026-11-08T1930Z-127.0.0.1-3000-100p.json')
  })

  it('reads back as it was written', () => {
    const path = writeRecord(folder, record)
    expect(path).toBe(join(folder, recordFileName(record)))
    expect(readRecord(path)).toEqual(record)
  })

  it('refuses a file that is not a results file, naming it', () => {
    const path = join(folder, 'not-a-run.json')
    writeFileSync(path, JSON.stringify({ phones: 3 }))
    expect(() => readRecord(path)).toThrow('not-a-run.json')
  })
})
