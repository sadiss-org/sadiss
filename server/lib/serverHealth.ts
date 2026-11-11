import { monitorEventLoopDelay } from 'perf_hooks'
import { ServerRecord } from './logRecords'

/**
 * How loaded the server is, sampled on a timer into the server-wide log: how
 * long the event loop was held up (which is how late every timer, chunk sends
 * included, can fire), CPU, memory and open sockets.
 */

/** How finely the event-loop delay is sampled, in ms. */
const RESOLUTION_MS = 10

const BYTES_PER_MB = 1024 * 1024

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places

/** How far past its schedule the histogram's timer fired, in ms: what it measured minus its own interval. */
const lateBy = (nanoseconds: number) => (Number.isFinite(nanoseconds) ? round(Math.max(0, nanoseconds / 1e6 - RESOLUTION_MS)) : 0)

export interface HealthSamplerOptions {
  /** How often a sample is written, in ms. */
  everyMs: number
  /** How many sockets are open now. */
  sockets: () => number
  write: (record: ServerRecord) => void
}

/**
 * Starts writing a `health` record every `everyMs`, each covering the time
 * since the one before. Returns the function that stops it.
 */
export const startHealthSampler = ({ everyMs, sockets, write }: HealthSamplerOptions) => {
  const delay = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
  delay.enable()
  let lastCpu = process.cpuUsage()
  let lastAt = process.hrtime.bigint()

  const timer = setInterval(() => {
    const now = process.hrtime.bigint()
    const cpu = process.cpuUsage(lastCpu)
    const wallUs = Number(now - lastAt) / 1000
    const memory = process.memoryUsage()

    write({
      type: 'health',
      eventLoopMeanMs: lateBy(delay.mean),
      eventLoopMaxMs: lateBy(delay.max),
      cpuPct: round(wallUs > 0 ? ((cpu.user + cpu.system) / wallUs) * 100 : 0),
      heapUsedMb: round(memory.heapUsed / BYTES_PER_MB),
      rssMb: round(memory.rss / BYTES_PER_MB),
      sockets: sockets()
    })

    delay.reset()
    lastCpu = process.cpuUsage()
    lastAt = now
  }, everyMs)

  // Don't let sampling alone keep the process alive, as with the heartbeat.
  timer.unref()

  return () => {
    clearInterval(timer)
    delay.disable()
  }
}
