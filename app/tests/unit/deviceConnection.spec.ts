import { connectDevice } from '@/composables/deviceConnection'
import { PROTOCOL_VERSION } from '@/composables/protocol'
import { FakeWebSocket, latestSocket } from './fakeWebSocket'

/**
 * The connection a phone keeps to the server, with the clock sync and the
 * playback stood in for, so only what the connection itself does is tested.
 */

const connect = (intervalMs = 3000) => {
  const playback: unknown[] = []
  const calls: string[] = []
  const clockSync = {
    start: vi.fn((send: (message: { message: 'measure'; t0: number }) => void) => {
      calls.push('clock started')
      send({ message: 'measure', t0: 1 })
    }),
    handleMessage: vi.fn((payload: { message?: unknown }) => payload.message === 'measureResponse'),
    intervalMs: () => intervalMs
  }
  const connection = connectDevice({
    url: 'wss://example/ws/',
    clientInfo: () => ({ clientId: 3, ttsLang: { iso: 'de-DE', lang: 'Deutsch' }, performanceId: 'performance-1' }),
    clockSync,
    onPlayback: (message) => playback.push(message),
    onLiveChange: () => undefined,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket
  })
  return { connection, clockSync, playback, calls }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.opened = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the connection a phone keeps to the server', () => {
  it('starts the clock sync and then introduces the phone each time it opens', () => {
    const { calls } = connect()
    latestSocket().open()

    expect(calls).toEqual(['clock started'])
    expect(latestSocket().sent.map((message) => JSON.parse(message))).toEqual([
      { message: 'measure', t0: 1 },
      {
        message: 'clientInfo',
        clientId: 3,
        ttsLang: { iso: 'de-DE', lang: 'Deutsch' },
        performanceId: 'performance-1',
        protocolVersion: PROTOCOL_VERSION
      }
    ])
  })

  it('gives clock messages to the clock sync and not to playback', () => {
    const { playback, clockSync } = connect()
    latestSocket().open()
    latestSocket().receive(JSON.stringify({ message: 'measureResponse', t0: 1, serverRecv: 2, serverSend: 2 }))

    expect(clockSync.handleMessage).toHaveBeenCalledTimes(1)
    expect(playback).toEqual([])
  })

  it('gives every other message to playback', () => {
    const { playback } = connect()
    latestSocket().open()
    latestSocket().receive(JSON.stringify({ start: true }))

    expect(playback).toEqual([{ start: true }])
  })

  it('ignores a message that is not JSON, such as the server confirming the handshake', () => {
    const { playback } = connect()
    latestSocket().open()

    expect(() => latestSocket().receive('clientInfoReceived')).not.toThrow()
    expect(playback).toEqual([])
  })

  it('gives a connection up after three clock replies missed at the cadence the server set', () => {
    connect(2000)
    latestSocket().open()

    vi.advanceTimersByTime(5999)
    expect(FakeWebSocket.opened).toHaveLength(1)
    vi.advanceTimersByTime(1 + 5000)
    expect(FakeWebSocket.opened).toHaveLength(2)
  })

  it('stops for good when closed', () => {
    const { connection } = connect()
    latestSocket().open()

    connection.close()
    vi.advanceTimersByTime(60000)

    expect(FakeWebSocket.opened).toHaveLength(1)
  })
})
