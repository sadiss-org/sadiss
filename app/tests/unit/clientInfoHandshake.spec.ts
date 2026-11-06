import { createTestingPinia } from '@pinia/testing'
import { useMainStore } from '@/stores/MainStore'
import { PROTOCOL_VERSION } from '@/composables/protocol'
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
  useClockMeasurement: () => ({ start: vi.fn(), handleMessage: () => false, intervalMs: () => 3000, stop: vi.fn() })
}))

createTestingPinia({ stubActions: false })
vi.stubGlobal('WebSocket', FakeWebSocket)

/** Connects and returns the clientInfo payload the app sent on open. */
const handshakePayload = async () => {
  const store = useMainStore()
  store.wsUrl = 'ws://localhost:8080'
  store.choirId = 3
  store.selectedLanguage = { iso: 'en-US', lang: 'English' }
  store.performanceId = 'performance-1'

  const { useWebsocketConnection } = await import('@/composables/useWebsocketConnection')
  await useWebsocketConnection().establishWebsocketConnection()

  const socket = latestSocket()
  socket.open()

  return socket.sent.map((message) => JSON.parse(message)).find((message) => message.message === 'clientInfo')
}

describe('clientInfo handshake', () => {
  it('tells the server which protocol version this app speaks', async () => {
    expect(await handshakePayload()).toEqual({
      message: 'clientInfo',
      clientId: 3,
      ttsLang: { iso: 'en-US', lang: 'English' },
      performanceId: 'performance-1',
      protocolVersion: PROTOCOL_VERSION
    })
  })

  it('speaks a protocol version above the unversioned one', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(1)
  })
})
