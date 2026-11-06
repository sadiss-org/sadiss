import { createResilientSocket, reconnectDelay } from '@/composables/resilientSocket'
import { FakeWebSocket, latestSocket as latest } from './fakeWebSocket'

/**
 * These drive a stand-in WebSocket by hand and move the clock by hand, so a
 * dropped connection or a stretch of silence costs a line rather than seconds.
 */

const SILENCE_LIMIT_MS = 9000

/** Longer than any delay a reconnect can be scheduled with. */
const LONGEST_RECONNECT_MS = 5000

const connect = (silenceLimitMs = () => SILENCE_LIMIT_MS) => {
  const received: string[] = []
  const liveness: boolean[] = []

  const socket = createResilientSocket({
    url: 'wss://example/ws/',
    onOpen: (send) => send('hello'),
    onMessage: (data) => received.push(data),
    onLiveChange: (live) => liveness.push(live),
    silenceLimitMs,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket
  })

  return { received, liveness, socket }
}

describe('a socket that keeps itself connected', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.opened = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says what it was told to say every time it opens', () => {
    connect()
    latest().open()

    expect(latest().sent).toEqual(['hello'])
  })

  it('passes on what it receives', () => {
    const { received } = connect()
    latest().open()
    latest().receive('state')

    expect(received).toEqual(['state'])
  })

  it('opens again after the connection drops, and says it again', () => {
    connect()
    latest().open()
    latest().drop()

    vi.advanceTimersByTime(reconnectDelay(0, () => 1))

    expect(FakeWebSocket.opened).toHaveLength(2)
    latest().open()
    expect(latest().sent).toEqual(['hello'])
  })

  it('tries again when a connection cannot be made at all', () => {
    connect()
    latest().fail()

    vi.advanceTimersByTime(reconnectDelay(0, () => 1))

    expect(FakeWebSocket.opened).toHaveLength(2)
  })

  it('tries again when the platform refuses to create the socket', () => {
    let refusals = 1

    createResilientSocket({
      url: 'ws://refused/',
      onOpen: () => {},
      onMessage: () => {},
      onLiveChange: () => {},
      silenceLimitMs: () => SILENCE_LIMIT_MS,
      WebSocketImpl: class {
        constructor(url: string) {
          if (refusals-- > 0) throw new DOMException('refused', 'SecurityError')
          return new FakeWebSocket(url)
        }
      } as unknown as typeof WebSocket
    })

    vi.advanceTimersByTime(LONGEST_RECONNECT_MS)

    expect(FakeWebSocket.opened).toHaveLength(1)
  })

  it('gives up on a connection that has gone quiet, and opens another', () => {
    connect()
    latest().open()
    latest().receive('state')
    const quiet = latest()

    vi.advanceTimersByTime(SILENCE_LIMIT_MS + LONGEST_RECONNECT_MS)

    expect(quiet.closed).toBe(true)
    expect(FakeWebSocket.opened.length).toBeGreaterThan(1)
  })

  it('gives up on a connection that never opens', () => {
    connect()
    const neverOpened = latest()

    vi.advanceTimersByTime(SILENCE_LIMIT_MS + LONGEST_RECONNECT_MS)

    expect(neverOpened.closed).toBe(true)
    expect(FakeWebSocket.opened.length).toBeGreaterThan(1)
  })

  it('does not give up on a connection that keeps talking', () => {
    connect()
    latest().open()

    for (let i = 0; i < 10; i++) {
      latest().receive('state')
      vi.advanceTimersByTime(SILENCE_LIMIT_MS - 1)
    }

    expect(FakeWebSocket.opened).toHaveLength(1)
  })

  it('allows the silence it is told to allow at the moment it listens', () => {
    let limitMs = 1000
    connect(() => limitMs)
    latest().open()

    limitMs = 20_000
    latest().receive('state')
    vi.advanceTimersByTime(15_000)

    expect(FakeWebSocket.opened).toHaveLength(1)
  })

  it('counts as live only once something has been heard', () => {
    const { liveness } = connect()
    latest().open()

    expect(liveness).toEqual([])

    latest().receive('state')

    expect(liveness).toEqual([true])
  })

  it('stops counting as live when the connection drops', () => {
    const { liveness } = connect()
    latest().open()
    latest().receive('state')
    latest().drop()

    expect(liveness).toEqual([true, false])
  })

  it('stops counting as live when the connection goes quiet', () => {
    const { liveness } = connect()
    latest().open()
    latest().receive('state')

    vi.advanceTimersByTime(SILENCE_LIMIT_MS)

    expect(liveness).toEqual([true, false])
  })

  it('waits longer each time it reconnects without hearing anything, up to a cap', () => {
    connect(() => 100)

    vi.advanceTimersByTime(30_000)

    const gaps = FakeWebSocket.opened.slice(1).map((socket, i) => socket.createdAt - FakeWebSocket.opened[i].createdAt)
    expect(gaps.length).toBeGreaterThan(4)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(LONGEST_RECONNECT_MS + 100)
  })

  it('goes back to reconnecting quickly once it has heard something', () => {
    connect()
    vi.advanceTimersByTime(60_000)

    latest().open()
    latest().receive('state')
    latest().drop()
    const droppedAt = Date.now()

    vi.advanceTimersByTime(reconnectDelay(0, () => 1))

    expect(latest().createdAt - droppedAt).toBeLessThanOrEqual(reconnectDelay(0, () => 1))
  })
})

describe('a socket that is closed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.opened = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes its connection and does not open another', () => {
    const { socket } = connect()
    latest().open()

    socket.close()
    vi.advanceTimersByTime(SILENCE_LIMIT_MS + LONGEST_RECONNECT_MS)

    expect(latest().closed).toBe(true)
    expect(FakeWebSocket.opened).toHaveLength(1)
  })

  it('does not open another when it is closed while waiting to reconnect', () => {
    const { socket } = connect()
    latest().fail()

    socket.close()
    vi.advanceTimersByTime(LONGEST_RECONNECT_MS)

    expect(FakeWebSocket.opened).toHaveLength(1)
  })

  it('passes on nothing more and stops counting as live', () => {
    const { socket, received, liveness } = connect()
    const first = latest()
    first.open()
    first.receive('before')

    socket.close()
    first.receive('after')

    expect(received).toEqual(['before'])
    expect(liveness).toEqual([true, false])
  })
})

describe('how long to wait before reconnecting', () => {
  it('grows with each attempt', () => {
    const fixed = () => 1
    expect(reconnectDelay(1, fixed)).toBeGreaterThan(reconnectDelay(0, fixed))
    expect(reconnectDelay(2, fixed)).toBeGreaterThan(reconnectDelay(1, fixed))
  })

  it('stops growing, so a phone back in range is not left waiting', () => {
    expect(reconnectDelay(50, () => 1)).toBeLessThanOrEqual(LONGEST_RECONNECT_MS)
  })

  it('is spread, not the same for every phone', () => {
    expect(reconnectDelay(3, () => 0)).toBeLessThan(reconnectDelay(3, () => 1))
  })
})
