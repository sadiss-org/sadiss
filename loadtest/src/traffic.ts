import { performance } from 'node:perf_hooks'
import { summarize, Summary } from './stats'

/**
 * The bytes of every message frame a phone's WebSocket connections carried so
 * far, each with its header. Control frames, such as pings, are not counted,
 * since the WebSocket API does not show them.
 */
export interface ByteCount {
  received: number
  sent: number
}

/** Each phone's byte counts at one moment, in the order the phones joined. */
export interface Tally {
  atMs: number
  phones: (ByteCount & { firstLiveAtMs: number | null })[]
}

/** Takes a tally of the phones, on the generator's `performance.now()` clock. */
export const tally = (phones: readonly { firstLiveAtMs: number | null; bytes: ByteCount }[], atMs = performance.now()): Tally => ({
  atMs,
  phones: phones.map((phone) => ({ firstLiveAtMs: phone.firstLiveAtMs, ...phone.bytes }))
})

/** The shortest time a phone is counted over; a rate over less says little. */
const SHORTEST_MS = 1000

const perSecond = (bytes: number, ms: number) => Number(((bytes * 1000) / ms).toFixed(2))

/**
 * How many bytes per second each phone received and sent from one tally to a
 * later one of the same audience, counted from the first tally or from when
 * the phone's connection first went live, whichever is later. A phone that
 * never went live, or was live for less than a second of the window, is left
 * out, so a window shorter than a second has no values.
 */
export const trafficBetween = (from: Tally, to: Tally): { received: Summary; sent: Summary } => {
  const rates = to.phones.flatMap((now, index) => {
    if (now.firstLiveAtMs === null) return []
    const before = from.phones[index]
    const ms = to.atMs - Math.max(from.atMs, now.firstLiveAtMs)
    if (ms < SHORTEST_MS) return []
    return [{ received: perSecond(now.received - (before?.received ?? 0), ms), sent: perSecond(now.sent - (before?.sent ?? 0), ms) }]
  })
  return { received: summarize(rates.map((rate) => rate.received)), sent: summarize(rates.map((rate) => rate.sent)) }
}

/** The bytes per second each phone received and sent, over the windows `runRoom` measures them in. */
export interface TrafficFigures {
  receivedBytesPerSDuringTrack: Summary
  sentBytesPerSDuringTrack: Summary
  receivedBytesPerSWhileSettling: Summary
  sentBytesPerSWhileSettling: Summary
}
