import { createTestingPinia } from '@pinia/testing'
import { useMainStore } from '@/stores/MainStore'
import { FakeWebSocket, latestSocket } from './fakeWebSocket'

vi.mock('@/composables/usePlayer', () => ({
  usePlayer: () => ({
    handleChunkData: vi.fn(),
    setOffset: vi.fn(),
    stopPlayback: vi.fn(),
    setStartTime: vi.fn(),
    setTrackSettings: vi.fn()
  })
}))

vi.mock('@/composables/useClockMeasurement', () => ({
  useClockMeasurement: () => ({
    clock: { estimate: () => null },
    now: () => 0,
    start: vi.fn(),
    handleMessage: () => false,
    intervalMs: () => 3000,
    stop: vi.fn()
  })
}))

/** A fresh copy of the connection module, so no test inherits another's state. */
const connection = async () => {
  createTestingPinia({ stubActions: false })
  useMainStore().wsUrl = 'ws://localhost:8080'
  const { useWebsocketConnection } = await import('@/composables/useWebsocketConnection')
  return useWebsocketConnection()
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  FakeWebSocket.opened = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a device whose first connection fails', () => {
  it('tries again by itself', async () => {
    const { establishWebsocketConnection } = await connection()
    await establishWebsocketConnection()

    latestSocket().fail()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(FakeWebSocket.opened.length).toBeGreaterThan(1)
  })

  it('tries again after the socket could not even be created', async () => {
    let refusals = 1
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(url: string) {
          if (refusals-- > 0) throw new DOMException('refused', 'SecurityError')
          return new FakeWebSocket(url)
        }
      }
    )
    const { establishWebsocketConnection } = await connection()

    await establishWebsocketConnection()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(FakeWebSocket.opened).not.toHaveLength(0)
  })
})
