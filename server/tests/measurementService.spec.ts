import { createMeasurementService } from '../services/measurementService'
import { MeasurementConfig } from '../types'

/** A clock that returns successive values from a fixed queue, for determinism. */
const fakeClock = (values: number[]) => {
  let i = 0
  return { now: () => values[Math.min(i++, values.length - 1)] }
}

const fakeClient = () => ({
  id: 'client-a',
  choirId: 3,
  performanceId: { toString: () => 'perf-1' },
  send: vi.fn()
})

const defaultConfig: MeasurementConfig = { intervalMs: 3000 }

describe('measurementService', () => {
  describe('handleMeasure', () => {
    it('responds with the ping echoed and stamped by the server clock', () => {
      const service = createMeasurementService({ clock: fakeClock([100, 101]), config: defaultConfig })
      const client = fakeClient()

      service.handleMeasure(client, { message: 'measure', t0: 55 })

      expect(client.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(client.send.mock.calls[0][0])).toEqual({
        message: 'measureResponse',
        t0: 55,
        serverRecv: 100,
        serverSend: 101
      })
    })

    it('always answers: the round trip is the shared clock, so it has no off switch', () => {
      const service = createMeasurementService({ clock: fakeClock([1, 2]), config: { intervalMs: 0 } })
      const client = fakeClient()

      service.handleMeasure(client, { message: 'measure', t0: 9 })

      expect(client.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('config', () => {
    it('exposes the active config as a pushable message', () => {
      const service = createMeasurementService({ clock: fakeClock([0]), config: defaultConfig })

      expect(service.buildConfigMessage(3)).toEqual({ message: 'measureConfig', config: defaultConfig })
    })

    it('can be reconfigured at runtime without rebuilding the service', () => {
      const service = createMeasurementService({ clock: fakeClock([0]), config: defaultConfig })

      service.setConfig({ intervalMs: 5000 })

      expect(service.buildConfigMessage(3)).toEqual({
        message: 'measureConfig',
        config: { intervalMs: 5000 }
      })
    })

    it('asks devices for a report on their state with each ping while reports are wanted', () => {
      const service = createMeasurementService({ clock: fakeClock([0]), config: defaultConfig, reportsWanted: () => true })

      expect(service.buildConfigMessage(3)).toEqual({ message: 'measureConfig', config: { intervalMs: 3000, report: true } })
    })

    it.each([1, 2])('never asks a device speaking protocol v%i, which has no report to send', (version) => {
      const service = createMeasurementService({ clock: fakeClock([0]), config: defaultConfig, reportsWanted: () => true })

      expect(service.buildConfigMessage(version)).toEqual({ message: 'measureConfig', config: { intervalMs: 3000 } })
    })

    it('leaves the report out of the config while none is wanted, so the message is what older servers sent', () => {
      const service = createMeasurementService({ clock: fakeClock([0]), config: defaultConfig, reportsWanted: () => false })

      expect(JSON.stringify(service.buildConfigMessage(3))).toBe('{"message":"measureConfig","config":{"intervalMs":3000}}')
    })
  })
})
