import { createTestingPinia } from '@pinia/testing'
import { useMainStore } from '@/stores/MainStore'
import { stayAlive } from '@/composables/stayAlive'
import { useWebsocketConnection } from '@/composables/useWebsocketConnection'

vi.mock('@/composables/stayAlive', () => ({ stayAlive: vi.fn() }))

vi.mock('@/composables/usePlayer', () => ({ usePlayer: () => ({}) }))
vi.mock('@/composables/useClockMeasurement', () => ({ useClockMeasurement: () => ({}) }))
vi.mock('@/composables/deviceIdentity', () => ({ loadDeviceIdentity: async () => () => ({}) }))
vi.mock('@/composables/deviceConnection', () => ({ connectDevice: vi.fn() }))

createTestingPinia({ stubActions: false })

describe('joining a performance', () => {
  it('keeps the phone running, once per app run', async () => {
    useMainStore().wsUrl = 'ws://localhost:8080'
    const { establishWebsocketConnection } = useWebsocketConnection()

    await establishWebsocketConnection()
    await establishWebsocketConnection()

    expect(stayAlive).toHaveBeenCalledTimes(1)
  })
})
