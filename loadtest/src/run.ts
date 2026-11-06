import { monitorEventLoopDelay } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { spread, summarize, Summary } from './measure'
import { createTarget } from './target'
import { TrackShape } from './track'
import { startVirtualPhone, VirtualPhone } from './virtualPhone'

export interface RunOptions {
  apiUrl: string
  wsUrl: string
  email: string
  password: string
  phones: number
  track: TrackShape
  /** Over how long the phones join, before the clock settles and the track starts. */
  joinOverMs: number
  /** How long the phones measure their clocks after the last one joined, before the track starts. */
  settleMs: number
}

export interface RunResult {
  phones: number
  track: TrackShape
  /** Before its first sound each chunk arrived, over every phone and chunk, in ms. */
  arrivalLeadMs: Summary
  /** Chunks a phone received before it had any clock estimate. */
  arrivalsWithoutClock: number
  /** Chunks of the track that some phone never received, counted per phone. */
  missingChunks: number
  connects: number
  drops: number
  roundTripMs: Summary
  /** Spread of the phones' clock offsets, sampled every second while the track played, in ms. */
  offsetSpreadMs: Summary
  /** Delay of the load generator's own event loop, in ms. */
  generatorDelayMs: { mean: number; p99: number; max: number }
}

const SAMPLE_EVERY_MS = 1000
const DELAY_RESOLUTION_MS = 10
/** Time after the track's last chunk for it to arrive everywhere. */
const TAIL_MS = 4000

export const runFixed = async (options: RunOptions): Promise<RunResult> => {
  const target = await createTarget(options.apiUrl, options.email, options.password)
  const performanceId = await target.prepare(options.track, `loadtest ${new Date().toISOString()}`)

  const generatorDelay = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS })
  generatorDelay.enable()

  const phones: VirtualPhone[] = []
  for (let i = 0; i < options.phones; i++) {
    phones.push(startVirtualPhone({ wsUrl: options.wsUrl, performanceId, choirId: 0, ttsLang: { iso: 'en-US', lang: 'English' } }))
    await sleep(options.joinOverMs / options.phones)
  }
  await sleep(options.settleMs)

  const spreads: number[] = []
  const sampler = setInterval(() => {
    const value = spread(phones.map((phone) => phone.offsetMs()))
    if (value !== null) spreads.push(value)
  }, SAMPLE_EVERY_MS)

  await target.start()
  await sleep(options.track.seconds * 1000 + TAIL_MS)
  await target.stop()
  clearInterval(sampler)
  generatorDelay.disable()

  const arrivals = phones.flatMap((phone) => phone.arrivals)
  const missingChunks = phones.reduce((sum, phone) => {
    const received = new Set(phone.arrivals.map((arrival) => arrival.chunk))
    return sum + Array.from({ length: options.track.seconds }, (_, chunk) => chunk).filter((chunk) => !received.has(chunk)).length
  }, 0)
  // The histogram holds the time between two of its timer ticks, so an idle
  // loop reads as the resolution itself; only what is above it is delay.
  const toMs = (ns: number) => Number(Math.max(0, ns / 1e6 - DELAY_RESOLUTION_MS).toFixed(3))

  return {
    phones: options.phones,
    track: options.track,
    arrivalLeadMs: summarize(arrivals.flatMap((arrival) => (arrival.leadMs === null ? [] : [arrival.leadMs]))),
    arrivalsWithoutClock: arrivals.filter((arrival) => arrival.leadMs === null).length,
    missingChunks,
    connects: phones.reduce((sum, phone) => sum + phone.connects, 0),
    drops: phones.reduce((sum, phone) => sum + phone.drops, 0),
    roundTripMs: summarize(phones.flatMap((phone) => phone.roundTripsMs)),
    offsetSpreadMs: summarize(spreads),
    generatorDelayMs: {
      mean: toMs(generatorDelay.mean),
      p99: toMs(generatorDelay.percentile(99)),
      max: toMs(generatorDelay.max)
    }
  }
}
