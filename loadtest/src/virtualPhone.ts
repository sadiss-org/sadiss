import { performance } from 'node:perf_hooks'
import { createClockSync } from '@/composables/clockSync'
import { connectDevice } from '@/composables/deviceConnection'
import type { ChunkEnvelope } from '@server/types/ChunkEnvelope'
import { chunkTiming } from './wire'

export interface PhoneOptions {
  wsUrl: string
  performanceId: string
  choirId: number
  ttsLang: { iso: string; lang: string }
}

/** One chunk as a virtual phone received it. */
export interface Arrival {
  chunk: number
  /** How long before its first sound it arrived, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
  leadMs: number | null
}

export interface VirtualPhone {
  arrivals: Arrival[]
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
export const startVirtualPhone = ({ wsUrl, performanceId, choirId, ttsLang }: PhoneOptions): VirtualPhone => {
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
    arrivals: [],
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
    clientInfo: () => ({ clientId: choirId, ttsLang, performanceId }),
    clockSync,
    onPlayback: (message) => {
      if (!isChunkEnvelope(message)) return
      const timing = chunkTiming(message)
      if (!timing) return
      const offset = clockSync.clock.offsetMs()
      phone.arrivals.push({
        chunk: timing.chunk,
        leadMs: offset === null ? null : timing.soundsAtServerMs - (performance.now() + offset)
      })
    },
    onLiveChange: (nowLive) => {
      if (live && !nowLive && !closed) phone.drops++
      live = nowLive
    },
    WebSocketImpl: CountedWebSocket
  })

  return phone
}
