import { performance } from 'node:perf_hooks'
import { createClockSync } from '@/composables/clockSync'
import { connectDevice } from '@/composables/deviceConnection'
import type { ChunkEnvelope } from '@server/types/ChunkEnvelope'
import { Seat } from './room'
import { chunkTiming } from './wire'

export interface PhoneOptions {
  wsUrl: string
  performanceId: string
  seat: Seat
}

/** One chunk as a virtual phone received it. */
export interface Arrival {
  chunk: number
  /** How long before its first sound it arrived, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
  leadMs: number | null
}

/** One phrase as a virtual phone was sent it. */
export interface PhraseArrival {
  /** When it is to be spoken, in seconds of track time. */
  time: number
  /** Its text, or null when the server sent the phrase without one, as for a language the track lacks. */
  text: string | null
  /** How long before its time it arrived, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
  leadMs: number | null
}

export interface VirtualPhone {
  seat: Seat
  /** When the phone started to connect, on the generator's `performance.now()` clock, in ms. */
  joinedAtMs: number
  /** When its connection first went live, on the same clock, or null while it never has. */
  firstLiveAtMs: number | null
  arrivals: Arrival[]
  phrases: PhraseArrival[]
  /** How often a connection was opened, and how often a live one was lost. */
  connects: number
  drops: number
  /** Round trip of every clock measurement, in ms. */
  roundTripsMs: number[]
  /** The phone's current estimate of server time minus its own, or null before the first round trip. */
  offsetMs(): number | null
  /** Disconnects for good. */
  close(): void
}

const isChunkEnvelope = (message: Record<string, unknown>): message is Record<string, unknown> & ChunkEnvelope =>
  typeof message.startTime === 'number' && typeof message.chunk === 'object' && message.chunk !== null

/**
 * A phone as the app is one: it connects through the app's own device
 * connection and clock sync, so it registers, keeps time and reconnects exactly
 * as a phone does, and records every chunk it is sent. It plays nothing.
 */
export const startVirtualPhone = ({ wsUrl, performanceId, seat }: PhoneOptions): VirtualPhone => {
  const roundTripsMs: number[] = []
  const clockSync = createClockSync({ now: () => performance.now(), onRoundTrip: (rttMs) => roundTripsMs.push(rttMs) })
  let live = false
  let closed = false

  // Counts every connection the app's socket opens.
  class CountedWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url)
      this.addEventListener('open', () => phone.connects++)
    }
  }

  const phone: VirtualPhone = {
    seat,
    joinedAtMs: performance.now(),
    firstLiveAtMs: null,
    arrivals: [],
    phrases: [],
    connects: 0,
    drops: 0,
    roundTripsMs,
    offsetMs: () => clockSync.clock.offsetMs(),
    close: () => {
      closed = true
      connection.close()
      clockSync.stop()
    }
  }

  const connection = connectDevice({
    url: wsUrl,
    clientInfo: () => ({ clientId: seat.choirId, ttsLang: seat.ttsLang, performanceId }),
    clockSync,
    onPlayback: (message) => {
      if (!isChunkEnvelope(message)) return
      const offset = clockSync.clock.offsetMs()
      const leadMs = (soundsAtServerMs: number) => (offset === null ? null : soundsAtServerMs - (performance.now() + offset))
      const timing = chunkTiming(message)
      if (timing) phone.arrivals.push({ chunk: timing.chunk, leadMs: leadMs(timing.soundsAtServerMs) })
      const phrase = message.chunk.ttsInstructions
      if (phrase) {
        phone.phrases.push({
          time: phrase.time,
          text: typeof phrase.phrase === 'string' ? phrase.phrase : null,
          leadMs: leadMs((message.startTime + phrase.time) * 1000)
        })
      }
    },
    onLiveChange: (nowLive) => {
      if (nowLive && phone.firstLiveAtMs === null) phone.firstLiveAtMs = performance.now()
      if (live && !nowLive && !closed) phone.drops++
      live = nowLive
    },
    WebSocketImpl: CountedWebSocket
  })

  return phone
}
