import { performance } from 'node:perf_hooks'
import { summarize, Summary } from './stats'

/** The bytes a phone's WebSocket connections carried so far, every frame counted whole, its header included. */
export interface ByteCount {
  received: number
  sent: number
}

/**
 * The size of a WebSocket frame that carries `payload` bytes: a 2-byte header,
 * 2 or 8 bytes more for a longer payload's length, and a 4-byte mask on every
 * frame a phone sends, since a client masks its frames and a server does not.
 */
export const frameBytes = (payload: number, fromPhone: boolean) =>
  payload + 2 + (payload > 0xffff ? 8 : payload > 125 ? 2 : 0) + (fromPhone ? 4 : 0)

/** The bytes of a message's payload: a text in UTF-8, binary data by its length. */
export const payloadBytes = (data: unknown) => {
  if (typeof data === 'string') return Buffer.byteLength(data)
  if (data instanceof Blob) return data.size
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data.byteLength
  return 0
}

/** Each phone's byte counts at one moment, in the order the phones joined. */
export interface Tally {
  atMs: number
  phones: (ByteCount & { joinedAtMs: number })[]
}

/** Takes a tally of the phones, on the generator's `performance.now()` clock. */
export const tally = (phones: readonly { joinedAtMs: number; bytes: ByteCount }[], atMs = performance.now()): Tally => ({
  atMs,
  phones: phones.map((phone) => ({ joinedAtMs: phone.joinedAtMs, ...phone.bytes }))
})

const perSecond = (bytes: number, ms: number) => Number(((bytes * 1000) / ms).toFixed(2))

/**
 * How many bytes per second each phone received and sent from one tally to a
 * later one of the same audience. A phone that joined in between is counted
 * from when it joined; one that joined as the later tally was taken has no
 * time to be counted over and is left out.
 */
export const trafficBetween = (from: Tally, to: Tally): { received: Summary; sent: Summary } => {
  const rates = to.phones.flatMap((now, index) => {
    const before = from.phones[index]
    const ms = to.atMs - (before ? from.atMs : now.joinedAtMs)
    if (ms <= 0) return []
    return [{ received: perSecond(now.received - (before?.received ?? 0), ms), sent: perSecond(now.sent - (before?.sent ?? 0), ms) }]
  })
  return { received: summarize(rates.map((rate) => rate.received)), sent: summarize(rates.map((rate) => rate.sent)) }
}

/** What each phone was sent and sent itself, per second, over the phones of the run. */
export interface TrafficFigures {
  /** While the track played, from half a chunk after its start over the track's length, so every chunk the server sent is counted once. */
  receivedBytesPerSDuringTrack: Summary
  sentBytesPerSDuringTrack: Summary
  /** While the phones that joined before the track settled their clocks, as between two tracks. */
  receivedBytesPerSBeforeTrack: Summary
  sentBytesPerSBeforeTrack: Summary
}

export const trafficFigures = (beforeTrack: ReturnType<typeof trafficBetween>, duringTrack: ReturnType<typeof trafficBetween>): TrafficFigures => ({
  receivedBytesPerSDuringTrack: duringTrack.received,
  sentBytesPerSDuringTrack: duringTrack.sent,
  receivedBytesPerSBeforeTrack: beforeTrack.received,
  sentBytesPerSBeforeTrack: beforeTrack.sent
})
