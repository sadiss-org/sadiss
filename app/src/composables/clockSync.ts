import { createMeasurementController, isInboundMeasurementMessage, MeasurementController } from './measurementController'
import { roundTripRtt, ServerClock } from './serverClock'
import { MeasureMessage, PhoneReport } from '@/types/measurement'

export interface ClockSync {
  /** The phone's estimate of the server clock. */
  clock: ServerClock
  /** The phone's own clock the estimate is measured against, in ms. */
  now(): number
  /**
   * Begins clock sync over a connection, replacing any earlier one. `report`
   * gives the phone's state, sent with each ping while the server asks for it.
   */
  start(send: (message: MeasureMessage) => void, report?: () => PhoneReport): void
  /**
   * Routes an inbound socket payload. Returns true if it was a clock-sync
   * message (and was handled), so the caller can skip its own processing.
   */
  handleMessage(payload: { message?: unknown }): boolean
  /** How often the server has asked for a round trip, or 0 before it has said. */
  intervalMs(): number
  /** Stops pinging. */
  stop(): void
}

/**
 * Drives clock sync over a connection: owns the ping timer, wires the clock and
 * the socket into the pure measurementController, and feeds each round trip into
 * the ServerClock.
 *
 * One clock for every connection. The server's clock does not change when the
 * connection does, and the estimate is built from a minute of round trips, so
 * starting it over would leave a reconnected phone silent until the first reply
 * and imprecise until the window refills.
 */
export const createClockSync = ({
  now = () => performance.now(),
  onRoundTrip
}: {
  /** The phone's own clock, in ms. */
  now?: () => number
  /** Called with the round-trip time of every completed measurement, in ms. */
  onRoundTrip?: (rttMs: number) => void
} = {}): ClockSync => {
  const clock = new ServerClock()
  let controller: MeasurementController | null = null
  let pingInterval: ReturnType<typeof setInterval> | null = null

  const stopPinging = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  const syncPingSchedule = () => {
    stopPinging()
    if (controller && controller.getIntervalMs() > 0) {
      pingInterval = setInterval(() => controller?.ping(), controller.getIntervalMs())
    }
  }

  return {
    clock,
    now,
    start: (send, report) => {
      controller = createMeasurementController({
        now,
        send,
        report,
        onRoundTrip: (roundTrip) => {
          clock.add(roundTrip)
          onRoundTrip?.(roundTripRtt(roundTrip))
        }
      })
    },
    handleMessage: (payload) => {
      if (!controller || !isInboundMeasurementMessage(payload)) return false
      controller.handleMessage(payload)
      syncPingSchedule()
      return true
    },
    intervalMs: () => controller?.getIntervalMs() ?? 0,
    stop: stopPinging
  }
}
