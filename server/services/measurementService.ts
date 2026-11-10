import { MeasureMessage, MeasureConfigMessage, MeasurementConfig } from '../types'

/** Source of the server's wall-clock time, injected so tests can be deterministic. */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

/** The connection fields the service needs — satisfied by SadissWebSocket. */
export interface MeasurementClient {
  id: string
  choirId: number
  performanceId: { toString(): string }
  send(data: string): void
}

export interface MeasurementServiceDeps {
  clock: Clock
  config: MeasurementConfig
  /** Whether devices are to send a report on their state with each ping, read each time the config is sent. */
  reportsWanted?: () => boolean
}

export interface MeasurementService {
  /** Answer a client's `measure` ping, stamping it with the server clock. */
  handleMeasure(client: MeasurementClient, message: MeasureMessage): void
  /** The active config wrapped as a server→client message. */
  buildConfigMessage(): MeasureConfigMessage
  /** How often devices are currently told to report. */
  reportingIntervalMs(): number
  /** Replace the active config at runtime (tunable without an app rebuild). */
  setConfig(config: MeasurementConfig): void
}

/**
 * Server half of clock sync. It is deliberately stateless per device: it stamps
 * each ping with the server clock and echoes it back, and every device derives
 * its own offset from that. There is no enable/disable switch — the round trip
 * IS the shared clock, so devices must always be able to run it.
 */
export const createMeasurementService = ({
  clock,
  config,
  reportsWanted = () => false
}: MeasurementServiceDeps): MeasurementService => {
  let activeConfig = config

  return {
    handleMeasure(client, message) {
      const serverRecv = clock.now()
      const response = {
        message: 'measureResponse' as const,
        t0: message.t0,
        serverRecv,
        serverSend: clock.now()
      }
      client.send(JSON.stringify(response))
    },

    buildConfigMessage() {
      // Left out rather than false while none is wanted, so the message is the one older servers sent.
      return { message: 'measureConfig', config: reportsWanted() ? { ...activeConfig, report: true } : activeConfig }
    },

    reportingIntervalMs() {
      return activeConfig.intervalMs
    },

    setConfig(config) {
      activeConfig = config
    }
  }
}
