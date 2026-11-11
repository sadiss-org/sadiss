import { connectDevice } from '@/composables/deviceConnection'
import { PROTOCOL_VERSION } from '@/composables/protocol'
import { FakeWebSocket, latestSocket } from './fakeWebSocket'
import { PhoneReport } from '@/types/measurement'
import { DeviceConnectionOptions, DeviceState } from '@/composables/deviceConnection'

/**
 * The connection a phone keeps to the server, with the clock sync and the
 * playback stood in for, so only what the connection itself does is tested.
 */

const connect = (
  intervalMs = 3000,
  extra: { deviceState?: () => DeviceState; onChunk?: DeviceConnectionOptions['onChunk'] } = {},
  now = () => 0
) => {
  const playback: unknown[] = []
  const calls: string[] = []
  let report: (() => PhoneReport) | undefined
  const clockSync = {
    clock: { estimate: () => ({ offsetMs: 5000, rttMs: 30, roundTrips: 4 }) },
    now: () => now(),
    start: vi.fn((send: (message: { message: 'measure'; t0: number }) => void, reportFor?: () => PhoneReport) => {
      calls.push('clock started')
      report = reportFor
      send({ message: 'measure', t0: 1 })
    }),
    handleMessage: vi.fn((payload: { message?: unknown }) => payload.message === 'measureResponse'),
    intervalMs: () => intervalMs,
    stop: vi.fn()
  }
  const connection = connectDevice({
    url: 'wss://example/ws/',
    clientInfo: () => ({ clientId: 3, ttsLang: { iso: 'de-DE', lang: 'Deutsch' }, performanceId: 'performance-1' }),
    clockSync,
    onPlayback: (message) => playback.push(message),
    onLiveChange: () => undefined,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    ...extra
  })
  return { connection, clockSync, playback, calls, report: () => report?.() }
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

  it('stops for good when closed, clock pings included', () => {
    const { connection, clockSync } = connect()
    latestSocket().open()

    connection.close()
    vi.advanceTimersByTime(60000)

    expect(FakeWebSocket.opened).toHaveLength(1)
    expect(clockSync.stop).toHaveBeenCalled()
  })

  it('reports how well the phone keeps time, how long it has been connected and how early the last chunk came', () => {
    let now = 1000
    const { report } = connect(3000, {}, () => now)
    latestSocket().open()
    now = 4000
    // Sounds at server time 10 s; the phone is 5 s behind the server, so at its 4 s it is server time 9 s.
    latestSocket().receive(
      JSON.stringify({
        startTime: 7,
        waveform: 'sine',
        ttsRate: 1,
        chunk: { partials: [{ index: 0, startTime: 3, endTime: 4, breakpoints: [] }] }
      })
    )
    // A chunk with only a phrase does not replace it.
    latestSocket().receive(
      JSON.stringify({ startTime: 7, waveform: 'sine', ttsRate: 1, chunk: { ttsInstructions: { time: 4, phrase: 'hallo' } } })
    )
    now = 6000

    expect(report()).toEqual({
      clock: { offsetMs: 5000, rttMs: 30, roundTrips: 4, connectedForMs: 5000 },
      audio: null,
      visible: null,
      keepAlivePlaying: null,
      lastChunk: { index: 3, leadMs: 1000 }
    })
  })

  it('adds what the app knows about its audio and screen to the report', () => {
    const state: DeviceState = { audio: null, visible: false, keepAlivePlaying: true }
    const { report } = connect(3000, { deviceState: () => state })
    latestSocket().open()

    expect(report()).toMatchObject({ visible: false, keepAlivePlaying: true, lastChunk: null })
  })

  it('still plays a chunk whose timing cannot be read', () => {
    const { playback, report } = connect()
    latestSocket().open()
    const malformed = { startTime: 7, waveform: 'sine', ttsRate: 1, chunk: { partials: 'not a list' } }

    latestSocket().receive(JSON.stringify(malformed))

    expect(playback).toEqual([malformed])
    expect(report()).toMatchObject({ lastChunk: null })
  })

  it('hands every chunk on with how early it came, for the load test to keep', () => {
    const chunks: unknown[] = []
    connect(3000, { onChunk: (message, arrival) => chunks.push([message.chunk, arrival]) }, () => 4000)
    latestSocket().open()

    latestSocket().receive(
      JSON.stringify({
        startTime: 7,
        waveform: 'sine',
        ttsRate: 1,
        chunk: { partials: [{ index: 0, startTime: 3, endTime: 4, breakpoints: [] }] }
      })
    )
    latestSocket().receive(
      JSON.stringify({ startTime: 7, waveform: 'sine', ttsRate: 1, chunk: { ttsInstructions: { time: 4, phrase: 'hallo' } } })
    )

    expect(chunks).toEqual([
      [{ partials: [{ index: 0, startTime: 3, endTime: 4, breakpoints: [] }] }, { chunk: 3, leadMs: 1000 }],
      [{ ttsInstructions: { time: 4, phrase: 'hallo' } }, null]
    ])
  })
})
