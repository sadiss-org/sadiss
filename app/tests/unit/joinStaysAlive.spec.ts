import { createTestingPinia } from '@pinia/testing'
import { useMainStore } from '@/stores/MainStore'

vi.mock('@/composables/stayAlive', () => ({ stayAlive: vi.fn() }))

vi.mock('@/composables/usePlayer', () => ({ usePlayer: () => ({}) }))
vi.mock('@/composables/useClockMeasurement', () => ({ useClockMeasurement: () => ({}) }))
vi.mock('@/composables/deviceIdentity', () => ({ loadDeviceIdentity: vi.fn(async () => () => ({})) }))
vi.mock('@/composables/deviceConnection', () => ({ connectDevice: vi.fn() }))

/** A fresh copy of the join module, so no test inherits another's once-per-run guard. */
const join = async (wsUrl = 'ws://localhost:8080') => {
  createTestingPinia({ stubActions: false })
  useMainStore().wsUrl = wsUrl
  const { useWebsocketConnection } = await import('@/composables/useWebsocketConnection')
  const { stayAlive } = await import('@/composables/stayAlive')
  const { loadDeviceIdentity } = await import('@/composables/deviceIdentity')
  return { ...useWebsocketConnection(), stayAlive: vi.mocked(stayAlive), loadDeviceIdentity: vi.mocked(loadDeviceIdentity) }
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

  // Android refuses to start the service once the app is in the background, so
  // the start must not wait for anything a locked screen could outlast.
  it('keeps the phone running before the server address is known', async () => {
    const { establishWebsocketConnection, stayAlive } = await join('')

    const joined = establishWebsocketConnection()

    expect(stayAlive).toHaveBeenCalledTimes(1)
    useMainStore().wsUrl = 'ws://localhost:8080'
    await joined
  })

  it('keeps the phone running before the device identity has loaded', async () => {
    const { establishWebsocketConnection, stayAlive, loadDeviceIdentity } = await join()
    loadDeviceIdentity.mockReturnValueOnce(new Promise(() => {}))

    void establishWebsocketConnection()

    expect(stayAlive).toHaveBeenCalledTimes(1)
  })

  it('joins without waiting for the phone to be kept running', async () => {
    const { establishWebsocketConnection, stayAlive } = await join()
    const { connectDevice } = await import('@/composables/deviceConnection')
    stayAlive.mockReturnValueOnce(new Promise(() => {}))

    await establishWebsocketConnection()

    expect(connectDevice).toHaveBeenCalledTimes(1)
  })
})
