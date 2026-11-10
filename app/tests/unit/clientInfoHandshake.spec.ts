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
  useClockMeasurement: () => ({
    clock: { estimate: () => null },
    now: () => 0,
    start: vi.fn(),
    handleMessage: () => false,
    intervalMs: () => 3000,
    stop: vi.fn()
  })
}))

vi.mock('@capacitor/preferences', () => {
  const stored = new Map<string, string>()
  return {
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: stored.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        stored.set(key, value)
      }
    }
  }
})

vi.mock('@capacitor/device', () => ({
  Device: { getInfo: async () => ({ platform: 'android', osVersion: '13', model: 'MAR-LX1A' }) }
}))

vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ build: '12' }) }
}))

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: true, connectionType: 'wifi' }),
    addListener: async () => ({ remove: async () => undefined })
  }
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
      protocolVersion: PROTOCOL_VERSION,
      device: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        appVersion: import.meta.env.VITE_APP_VERSION,
        appBuild: '12',
        platform: 'android',
        osVersion: '13',
        model: 'MAR-LX1A',
        network: 'wifi'
      }
    })
  })

  it('speaks a protocol version above the unversioned one', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(1)
  })
})
