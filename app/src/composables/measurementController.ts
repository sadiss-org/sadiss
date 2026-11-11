import { InboundMeasurementMessage, MeasurementConfig, MeasureMessage, PhoneReport } from '@/types/measurement'
import { RoundTrip } from './serverClock'

/**
 * Dependencies the controller needs, all injected so the logic stays pure and
 * framework-agnostic (and unit-testable without a socket or timers).
 */
export interface MeasurementControllerDeps {
  /** Local clock in milliseconds (e.g. performance.now()). */
  now(): number
  /** Send an assembled protocol message to the server. */
  send(message: MeasureMessage): void
  /** Called with each completed round trip, so the clock can update from it. */
  onRoundTrip?(roundTrip: RoundTrip): void
  /** The phone's state, sent with each ping while the server asks for it. */
  report?(): PhoneReport
}

export interface MeasurementController {
  /** Apply a new clock-sync configuration. */
  setConfig(config: MeasurementConfig): void
  getIntervalMs(): number
  /** Send one clock-sync ping. */
  ping(): void
  /** React to an inbound message (config update or server response). */
  handleMessage(message: InboundMeasurementMessage): void
}

/**
 * Narrows an arbitrary parsed socket payload to a clock-sync message at the
 * untyped boundary, so the rest of the code works with precise types and no casts.
 */
export const isInboundMeasurementMessage = (payload: { message?: unknown }): payload is InboundMeasurementMessage =>
  payload.message === 'measureConfig' || payload.message === 'measureResponse'

/** The report to send with a ping, or nothing when it cannot be made: the ping is the clock and must go out. */
const reportOrNothing = (report: (() => PhoneReport) | undefined): { report?: PhoneReport } => {
  if (!report) return {}
  try {
    return { report: report() }
  } catch (err) {
    console.warn('Could not make the phone report:', err)
    return {}
  }
}

/**
 * Drives the device side of clock sync: pings the server and turns each
 * response into a completed round trip for the ServerClock. It performs no
 * estimation itself — the clock owns that. Cadence comes from the server via
 * `measureConfig`, so it is tunable without an app rebuild.
 */
export const createMeasurementController = ({
  now,
  send,
  onRoundTrip,
  report
}: MeasurementControllerDeps): MeasurementController => {
  let config: MeasurementConfig = { intervalMs: 0 }

  return {
    setConfig(next) {
      config = next
    },

    getIntervalMs() {
      return config.intervalMs
    },

    ping() {
      // Made before the stamp, so making it does not count toward the round trip.
      const extra = config.report ? reportOrNothing(report) : {}
      send({ message: 'measure', t0: now(), ...extra })
    },

    handleMessage(message) {
      if (message.message === 'measureConfig') {
        config = message.config
        return
      }

      if (message.message === 'measureResponse') {
        const t3 = now()
        onRoundTrip?.({ t0: message.t0, serverRecv: message.serverRecv, serverSend: message.serverSend, t3 })
      }
    }
  }
}
