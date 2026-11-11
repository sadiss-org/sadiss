import { MeasureMessage, MeasureConfigMessage, MeasurementConfig } from '../types'

/** Source of the server's wall-clock time, injected so tests can be deterministic. */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

/** The first protocol version whose builds send a report with their pings. */
export const PROTOCOL_VERSION_WITH_REPORTS = 3

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
  /** The active config wrapped as a server→client message, for a device speaking `protocolVersion`. */
  buildConfigMessage(protocolVersion: number): MeasureConfigMessage
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

    buildConfigMessage(protocolVersion) {
      // Left out rather than false while none is wanted, and for builds that have no report to send,
      // so they get the message older servers sent.
      const askForReport = protocolVersion >= PROTOCOL_VERSION_WITH_REPORTS && reportsWanted()
      return { message: 'measureConfig', config: askForReport ? { ...activeConfig, report: true } : activeConfig }
    },

    reportingIntervalMs() {
      return activeConfig.intervalMs
    },

    setConfig(config) {
      activeConfig = config
    }
  }
}
