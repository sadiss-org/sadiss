import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { RampEnd } from './ramp'
import { RunResult } from './results'
import { ServerSample } from './serverSampler'
import { Verdict } from './verdict'

/** What a results file keeps about how and where a run, or a ramp, was made. */
export interface RunMeta {
  /** The commit the server under test was built from, with `-dirty` when it ran from a checkout with uncommitted changes; null when unknown. */
  serverCommit: string | null
  /** The commit of the load test that ran, with `-dirty` likewise; null when unknown. */
  loadtestCommit: string | null
  target: { apiUrl: string; wsUrl: string }
  /** When the run started, as an ISO 8601 date and time in UTC, or a date alone for a run whose time was not kept. */
  runAt: string
  /** The machine the load generator ran on. */
  generator: { cpu: string; threads: number; node: string; platform: string }
  /** What the numbers do not say, such as what else ran on the box, given with --note; null when none was given. */
  note: string | null
}

/** Everything a results file keeps about one run, so it can be read and compared later. */
export interface RunRecord extends RunMeta {
  result: RunResult
  verdict: Verdict
  /** The server under test and its box, sampled every few seconds through the run. */
  serverSamples: ServerSample[]
  /** Why there are no server samples, or null when there are. */
  notSampledBecause: string | null
}

/** Letters, digits, dots and dashes only, so a URL can be part of a file name. */
const slug = (url: string) =>
  url
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[^A-Za-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '')

/** Everything a ramp's results file keeps: each step as one run's results file does, and how the ramp ended. */
export interface RampRecord extends RunMeta {
  ramp: { start: number; step: number }
  steps: Omit<RunRecord, keyof RunMeta>[]
  end: RampEnd
}

const fileName = (meta: RunMeta, what: string) => {
  const [date = '', time = ''] = meta.runAt.split('T')
  const when = time ? `${date}T${time.slice(0, 2)}${time.slice(3, 5)}Z` : date
  return `${when}-${slug(meta.target.apiUrl)}-${what}.json`
}

/** `<date>T<hours><minutes>Z-<target>-<phones>p.json`, so a folder of results lists in the order the runs were made. */
export const recordFileName = (record: RunRecord) => fileName(record, `${record.result.phones}p`)

/** `<date>T<hours><minutes>Z-<target>-ramp.json`. */
export const rampFileName = (record: RampRecord) => fileName(record, 'ramp')

const write = (folder: string, name: string, content: object) => {
  mkdirSync(folder, { recursive: true })
  const path = join(folder, name)
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`)
  return path
}

/** Writes a run's results file into `folder` and returns its path. */
export const writeRecord = (folder: string, record: RunRecord) => write(folder, recordFileName(record), record)

/** Writes a ramp's results file into `folder` and returns its path. */
export const writeRampRecord = (folder: string, record: RampRecord) => write(folder, rampFileName(record), record)

const isRecord = (value: unknown): value is RunRecord => {
  if (typeof value !== 'object' || value === null) return false
  const fields = ['serverCommit', 'loadtestCommit', 'target', 'runAt', 'generator', 'note', 'result', 'verdict', 'serverSamples', 'notSampledBecause']
  return fields.every((field) => field in value)
}

/** Reads a results file. A file that is not one is refused, by name. */
export const readRecord = (path: string): RunRecord => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  if (!isRecord(parsed)) throw new Error(`${basename(path)} is not a load test results file.`)
  return parsed
}
