import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline'
import { Capacity, LOCAL_HOSTS } from './serverCommit'
import { summarize, Summary } from './stats'

/** One sample of the server under test and the box it runs on. */
export interface ServerSample {
  /** When it arrived, in seconds since sampling started, by the load generator's clock. */
  atS: number
  /** The process listening on the server's HTTP port, or null while none did. */
  pid: number | null
  /** The share of one core the process used since the sample before, in percent; null for its first sample. A server whose main thread is always busy reads about 100. */
  cpuPct: number | null
  /** Its resident memory, in MB. */
  rssMb: number | null
  /** Its open sockets, listening ones included. */
  sockets: number | null
  /** The box's load averaged over the last minute. */
  boxLoad: number
  /** The box's memory available to new processes, in MB. */
  boxAvailableMb: number
}

/** The figures of a run the samples give. */
export interface ServerFigures {
  serverCpuPct: Summary
  serverRssMb: Summary
  serverSockets: Summary
  /** How often the process listening on the server's port changed, such as after a crash; null when the server was not sampled. */
  serverRestarts: number | null
  boxLoad: Summary
  boxAvailableMb: Summary
}

const toMb = (kb: number) => Number((kb / 1024).toFixed(2))
const field = (value: string | undefined) => (value === undefined || value === '-' ? null : Number(value))

/** Turns the lines the sampling script printed, each with when it arrived, into samples; lines that are not samples are left out. */
export const parseSamples = (lines: readonly { atS: number; line: string }[]): ServerSample[] => {
  const samples: ServerSample[] = []
  let previous: { pid: number; ticks: number; ns: number } | null = null
  for (const { atS, line } of lines) {
    const [kind, ns, pid, ticks, rssKb, sockets, load, availableKb, tck] = line.trim().split(/\s+/)
    if (kind !== 'sample' || tck === undefined) continue
    const now = { pid: field(pid), ticks: field(ticks), ns: Number(ns) }
    const ticksPerSecond = Number(tck)
    const cpuPct =
      previous && now.pid === previous.pid && now.ticks !== null
        ? Number(((100 * (now.ticks - previous.ticks)) / ticksPerSecond / ((now.ns - previous.ns) / 1e9)).toFixed(2))
        : null
    const rss = field(rssKb)
    samples.push({
      atS,
      pid: now.pid,
      cpuPct,
      rssMb: rss === null ? null : toMb(rss),
      sockets: field(sockets),
      boxLoad: Number(load),
      boxAvailableMb: toMb(Number(availableKb))
    })
    previous = now.pid !== null && now.ticks !== null ? { pid: now.pid, ticks: now.ticks, ns: now.ns } : null
  }
  return samples
}

const known = (values: (number | null)[]) => values.filter((value): value is number => value !== null)

export const serverFigures = (samples: readonly ServerSample[]): ServerFigures => {
  const pids = known(samples.map((sample) => sample.pid))
  return {
    serverCpuPct: summarize(known(samples.map((sample) => sample.cpuPct))),
    serverRssMb: summarize(known(samples.map((sample) => sample.rssMb))),
    serverSockets: summarize(known(samples.map((sample) => sample.sockets))),
    serverRestarts: samples.length ? pids.filter((pid, index) => index > 0 && pid !== pids[index - 1]).length : null,
    boxLoad: summarize(samples.map((sample) => sample.boxLoad)),
    boxAvailableMb: summarize(samples.map((sample) => sample.boxAvailableMb))
  }
}

/** How to run the sampling script next to the server, and the port its process listens on. */
export type SamplingTarget = { command: string; args: string[]; port: number } | { notSampledBecause: string }

/** The capacity instance is sampled over ssh, a server on this machine directly; any other server cannot be. */
export const samplingTarget = (apiUrl: string, capacity: Capacity): SamplingTarget => {
  if (apiUrl.startsWith(capacity.url)) {
    return { command: 'ssh', args: ['-o', 'BatchMode=yes', capacity.host, 'sh', '-s'], port: capacity.httpPort }
  }
  const url = new URL(apiUrl)
  if (LOCAL_HOSTS.has(url.hostname)) {
    return { command: 'sh', args: ['-s'], port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) }
  }
  return { notSampledBecause: `there is no way to reach the box of ${url.host}; only the capacity instance and a server on this machine are sampled.` }
}

const SCRIPT = readFileSync(new URL('sampleServer.sh', import.meta.url), 'utf-8')

export interface Sampled {
  samples: ServerSample[]
  /** Why there are no samples, or null when there are. */
  notSampledBecause: string | null
}

/**
 * Starts sampling the server every `everyS` seconds, for at most `forAtMostS`
 * seconds, so a sampler that is never stopped ends on its own. A command that
 * fails never fails the run: stopping then says why there are no samples.
 */
export const startSampler = (
  target: { command: string; args: string[]; port: number },
  { everyS, forAtMostS }: { everyS: number; forAtMostS: number }
) => {
  const startedAt = performance.now()
  const lines: { atS: number; line: string }[] = []
  let errorOutput = ''
  let failure: string | null = null

  const child = spawn(target.command, [...target.args, '--', String(target.port), String(everyS), String(forAtMostS)], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exited = new Promise<void>((resolve) => {
    child.once('close', (code, signal) => {
      if (code !== 0 && signal === null) failure = `${target.command} exited with code ${code}`
      resolve()
    })
    child.once('error', (error) => {
      failure = `${target.command} could not be started: ${error.message}`
      resolve()
    })
  })
  child.stdin.on('error', () => undefined)
  child.stdin.end(SCRIPT)
  createInterface({ input: child.stdout }).on('line', (line) => lines.push({ atS: Number(((performance.now() - startedAt) / 1000).toFixed(3)), line }))
  child.stderr.on('data', (data: Buffer) => (errorOutput = (errorOutput + data.toString()).slice(-500)))

  return {
    /** Stops sampling and returns what was sampled. */
    stop: async (): Promise<Sampled> => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
      const samples = parseSamples(lines)
      if (samples.length) return { samples, notSampledBecause: null }
      const why = [failure, errorOutput.trim()].filter(Boolean).join(': ')
      return { samples, notSampledBecause: why || 'the sampling script printed no sample.' }
    }
  }
}
