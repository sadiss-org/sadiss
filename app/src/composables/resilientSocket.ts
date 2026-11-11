/**
 * A websocket that keeps itself connected.
 *
 * The caller says what to send each time the connection opens and what to do with
 * each message, and never sees a connection come or go: dropping, reconnecting
 * and giving up on a connection that has died without closing all happen in
 * here. This knows nothing about what the messages mean.
 *
 * A connection counts as live only while it is being heard from. A phone can
 * report a connection as open long after the network under it has gone, and
 * reports its close late or not at all, so silence is the signal: a peer that has
 * said nothing for `silenceLimitMs` is given up on and replaced.
 *
 * The admin interface keeps its connection up with the same module, in
 * admin_client/src/composables/resilientSocket.ts. The two packages share no code.
 */

const FIRST_RECONNECT_MS = 500
const LONGEST_RECONNECT_MS = 5000

/**
 * How long to wait before reconnecting, after `attempt` tries that heard nothing.
 *
 * Doubles each time, so a server that keeps refusing is not asked every few
 * milliseconds, up to a cap short enough that a phone back in range is playing
 * again within seconds. Spread by up to half, so a room of phones losing a
 * restarting server does not come back at the same instant.
 */
export const reconnectDelay = (attempt: number, random: () => number = Math.random) => {
  const ceiling = Math.min(LONGEST_RECONNECT_MS, FIRST_RECONNECT_MS * 2 ** attempt)
  return ceiling * (0.5 + random() / 2)
}

export interface ResilientSocketOptions {
  url: string
  /** Called each time a connection opens, with a way to send on it. */
  onOpen: (send: (data: string) => void) => void
  onMessage: (data: string) => void
  /** Called when the connection starts or stops being heard from. */
  onLiveChange: (live: boolean) => void
  /** How long a connection may say nothing before it is treated as dead, read afresh each time it is timed. */
  silenceLimitMs: () => number
  WebSocketImpl?: typeof WebSocket
}

/** Connects, and stays connected until it is closed. */
export const createResilientSocket = ({
  url,
  onOpen,
  onMessage,
  onLiveChange,
  silenceLimitMs,
  WebSocketImpl = WebSocket
}: ResilientSocketOptions) => {
  let socket: WebSocket | undefined
  let silence: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let attempt = 0
  let live = false

  const setLive = (value: boolean) => {
    if (live === value) return
    live = value
    onLiveChange(value)
  }

  const expectToHear = () => {
    clearTimeout(silence)
    silence = setTimeout(abandon, silenceLimitMs())
  }

  /** Lets go of the current connection, whatever state it is in. */
  const letGo = () => {
    clearTimeout(silence)

    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close()
      socket = undefined
    }

    setLive(false)
  }

  /** Lets go of the current connection and replaces it. */
  const abandon = () => {
    letGo()
    retry = setTimeout(connect, reconnectDelay(attempt))
    attempt++
  }

  const connect = () => {
    if (closed) return
    let current: WebSocket
    try {
      current = new WebSocketImpl(url)
    } catch {
      // A URL the platform refuses, from a bad code or a scheme it does not
      // allow, is treated as a connection that failed: the phone keeps showing
      // that it is trying instead of stopping in a state nothing leaves.
      abandon()
      return
    }
    socket = current

    // Started before the connection opens, so one that never opens is given up
    // on the same way as one that stops talking.
    expectToHear()

    current.onopen = () => onOpen((data) => current.send(data))

    current.onmessage = (event) => {
      attempt = 0
      setLive(true)
      expectToHear()
      onMessage(event.data)
    }

    current.onclose = abandon
  }

  connect()

  return {
    /** Closes the connection for good: nothing is passed on or reconnected after this. */
    close: () => {
      closed = true
      clearTimeout(retry)
      letGo()
    }
  }
}
