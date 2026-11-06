import { ClientInfoMessage, buildClientInfoMessage } from './protocol'
import { createResilientSocket } from './resilientSocket'
import { ClockSync } from './clockSync'

/**
 * Clock-sync replies a connection may miss before it is given up on. Between
 * them a connected device hears nothing unless a track is playing.
 */
const REPLIES_MISSED_BEFORE_GIVING_UP = 3

/** The cadence assumed until the server has said, which is also how long a new connection has to answer. */
const ASSUMED_MEASURE_INTERVAL_MS = 3000

export interface DeviceConnectionOptions {
  url: string
  /** Who this phone is, read each time a connection opens. */
  clientInfo: () => Omit<ClientInfoMessage, 'message' | 'protocolVersion'>
  clockSync: Pick<ClockSync, 'start' | 'handleMessage' | 'intervalMs' | 'stop'>
  /** Every message that is not about the clock: start, stop and chunks. */
  onPlayback: (message: Record<string, unknown>) => void
  onLiveChange: (live: boolean) => void
  /** Called with every message as it arrives, before anything is done with it. */
  log?: (raw: string) => void
  WebSocketImpl?: typeof WebSocket
}

/**
 * The connection a phone keeps to the server while it is in a performance: it
 * keeps itself connected, starts the clock sync and introduces the phone each
 * time it opens, gives clock messages to the clock sync and everything else to
 * playback. It knows nothing about Vue or the device, so the load test's
 * virtual phones connect through it too. Closing it also stops the clock sync.
 */
export const connectDevice = ({ url, clientInfo, clockSync, onPlayback, onLiveChange, log, WebSocketImpl }: DeviceConnectionOptions) => {
  const socket = createResilientSocket({
    url,
    onOpen: (send) => {
      clockSync.start((message) => send(JSON.stringify(message)))
      send(JSON.stringify(buildClientInfoMessage(clientInfo())))
    },
    onMessage: (raw) => {
      if (!raw) return
      log?.(raw)
      let message: unknown
      try {
        message = JSON.parse(raw)
      } catch {
        // The server also sends plain text, such as its handshake confirmation.
        return
      }
      if (typeof message !== 'object' || message === null) return
      if (clockSync.handleMessage(message)) return
      onPlayback({ ...message })
    },
    onLiveChange,
    silenceLimitMs: () => REPLIES_MISSED_BEFORE_GIVING_UP * (clockSync.intervalMs() || ASSUMED_MEASURE_INTERVAL_MS),
    WebSocketImpl
  })

  return {
    /** Disconnects for good and stops the clock sync's pings. */
    close: () => {
      socket.close()
      clockSync.stop()
    }
  }
}
