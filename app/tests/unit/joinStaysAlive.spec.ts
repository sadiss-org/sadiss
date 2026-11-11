import { createTestingPinia } from '@pinia/testing'
import { useMainStore } from '@/stores/MainStore'

vi.mock('@/composables/stayAlive', () => ({ stayAlive: vi.fn() }))

vi.mock('@/composables/usePlayer', () => ({ usePlayer: () => ({}) }))
vi.mock('@/composables/useClockMeasurement', () => ({ useClockMeasurement: () => ({}) }))
vi.mock('@/composables/deviceIdentity', () => ({ loadDeviceIdentity: async () => () => ({}) }))
vi.mock('@/composables/deviceConnection', () => ({ connectDevice: vi.fn() }))

/** A fresh copy of the join module, so no test inherits another's once-per-run guard. */
const join = async () => {
  createTestingPinia({ stubActions: false })
  useMainStore().wsUrl = 'ws://localhost:8080'
  const { useWebsocketConnection } = await import('@/composables/useWebsocketConnection')
  const { stayAlive } = await import('@/composables/stayAlive')
  return { ...useWebsocketConnection(), stayAlive }
}

beforeEach(() => {
  vi.resetModules()
  // A module reset keeps the stand-in, and with it the calls of earlier tests.
  vi.clearAllMocks()
})

describe('joining a performance', () => {
  it('keeps the phone running', async () => {
    const { establishWebsocketConnection, stayAlive } = await join()

    await establishWebsocketConnection()

    expect(stayAlive).toHaveBeenCalledTimes(1)
  })

  it('keeps the phone running once per app run, however often it joins', async () => {
    const { establishWebsocketConnection, stayAlive } = await join()

    await establishWebsocketConnection()
    await establishWebsocketConnection()

    expect(stayAlive).toHaveBeenCalledTimes(1)
  })
})
