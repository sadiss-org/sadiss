import { performance } from 'node:perf_hooks'
import { roundTripRtt, ServerClock } from '@/composables/serverClock'
import { createMeasurementController, isInboundMeasurementMessage, MeasurementController } from '@/composables/measurementController'
import { buildClientInfoMessage } from '@/composables/protocol'
import { createResilientSocket } from '@/composables/resilientSocket'
import { arrivalLeadMs, ChunkMessage, chunkNumber } from './measure'

// The app gives a silent connection up after this many missed clock replies, at
// the cadence the server set or 3 s before it has said
// (app/src/composables/useWebsocketConnection.ts). The app module itself cannot
// be imported here, because it pulls in Vue and Capacitor.
const REPLIES_MISSED_BEFORE_GIVING_UP = 3
const ASSUMED_MEASURE_INTERVAL_MS = 3000

export interface PhoneOptions {
  wsUrl: string
  performanceId: string
  choirId: number
  ttsLang: { iso: string; lang: string }
}

/** One chunk as a virtual phone received it. */
export interface Arrival {
  chunk: number
  /** Before its first sound, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
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
}

/**
 * A phone as the app is one: it registers for a performance, keeps its clock in
 * sync with the app's own measurement code, reconnects with the app's own
 * socket, and records every chunk it is sent. It plays nothing.
 */
export const startVirtualPhone = ({ wsUrl, performanceId, choirId, ttsLang }: PhoneOptions): VirtualPhone => {
  const clock = new ServerClock()
  let controller: MeasurementController | null = null
  let pinging: ReturnType<typeof setInterval> | undefined
  let live = false

  const phone: VirtualPhone = {
    arrivals: [],
    connects: 0,
    drops: 0,
    roundTripsMs: [],
    offsetMs: () => clock.offsetMs()
  }

  // Mirrors the app's useClockMeasurement: ping at the cadence the server sets.
  const syncPingSchedule = () => {
    clearInterval(pinging)
    const intervalMs = controller?.getIntervalMs() ?? 0
    if (intervalMs > 0) pinging = setInterval(() => controller?.ping(), intervalMs)
  }

  const handleMessage = (raw: string) => {
    if (!raw || raw === 'clientInfoReceived') return
    const payload = JSON.parse(raw)
    if (controller && isInboundMeasurementMessage(payload)) {
      controller.handleMessage(payload)
      syncPingSchedule()
      return
    }
    if (payload.chunk?.partials?.length) {
      const message = payload as ChunkMessage
      const offset = clock.offsetMs()
      phone.arrivals.push({
        chunk: chunkNumber(message),
        leadMs: offset === null ? null : arrivalLeadMs(message, performance.now(), offset)
      })
    }
  }

  createResilientSocket({
    url: wsUrl,
    onOpen: (send) => {
      phone.connects++
      controller = createMeasurementController({
        now: () => performance.now(),
        send: (message) => send(JSON.stringify(message)),
        onRoundTrip: (roundTrip) => {
          clock.add(roundTrip)
          phone.roundTripsMs.push(roundTripRtt(roundTrip))
        }
      })
      send(JSON.stringify(buildClientInfoMessage({ clientId: choirId, ttsLang, performanceId })))
    },
    onMessage: handleMessage,
    onLiveChange: (nowLive) => {
      if (live && !nowLive) phone.drops++
      live = nowLive
    },
    silenceLimitMs: () => REPLIES_MISSED_BEFORE_GIVING_UP * (controller?.getIntervalMs() || ASSUMED_MEASURE_INTERVAL_MS)
  })

  return phone
}
