import { ClientInfoMessage, buildClientInfoMessage } from './protocol'
import { createResilientSocket } from './resilientSocket'
import { ClockSync } from './clockSync'
import { chunkLeadMs, chunkTiming } from './chunkTiming'
import { PhoneReport, PhraseReport } from '@/types/measurement'
import { ChunkEnvelope } from '@/types/types'

/**
 * Clock-sync replies a connection may miss before it is given up on. Between
 * them a connected device hears nothing unless a track is playing.
 */
const REPLIES_MISSED_BEFORE_GIVING_UP = 3

/** The cadence assumed until the server has said, which is also how long a new connection has to answer. */
const ASSUMED_MEASURE_INTERVAL_MS = 3000

/** A chunk's number and how long before its first sound it arrived, in ms, or null while the clock has no estimate. */
export interface ChunkArrival {
  chunk: number
  leadMs: number | null
}

/** What the phone itself can say about its audio and screen, for the report. */
export type DeviceState = Pick<PhoneReport, 'audio' | 'visible' | 'keepAlivePlaying'>

/** A device that plays nothing, such as the load test's virtual phones, knows none of it. */
const NO_DEVICE_STATE: DeviceState = { audio: null, visible: null, keepAlivePlaying: null }

const isChunkEnvelope = (message: object): message is ChunkEnvelope =>
  'startTime' in message &&
  typeof message.startTime === 'number' &&
  'chunk' in message &&
  typeof message.chunk === 'object' &&
  message.chunk !== null

export interface DeviceConnectionOptions {
  url: string
  /** Who this phone is, read each time a connection opens. */
  clientInfo: () => Omit<ClientInfoMessage, 'message' | 'protocolVersion'>
  clockSync: Pick<ClockSync, 'start' | 'handleMessage' | 'intervalMs' | 'stop' | 'now'> & {
    clock: Pick<ClockSync['clock'], 'estimate'>
  }
  /** Every message that is not about the clock: start, stop and chunks. */
  onPlayback: (message: Record<string, unknown>) => void
  onLiveChange: (live: boolean) => void
  /** Called with every message as it arrives, before anything is done with it. */
  log?: (raw: string) => void
  /** The phone's audio and screen state, for the report it sends when the server asks. */
  deviceState?: () => DeviceState
  /** The TTS phrases finished since it was last called, for the report; a device that speaks none leaves it out. */
  takePhraseReports?: () => PhraseReport[]
  /**
   * Called with every chunk message after playback has it, and the chunk's
   * number and how early it came by the phone's clock, or null for a chunk
   * without partials.
   */
  onChunk?: (message: ChunkEnvelope, arrival: ChunkArrival | null) => void
  WebSocketImpl?: typeof WebSocket
}

/**
 * The connection a phone keeps to the server while it is in a performance: it
 * keeps itself connected, starts the clock sync and introduces the phone each
 * time it opens, gives clock messages to the clock sync and everything else to
 * playback. It knows nothing about Vue or the device, so the load test's
 * virtual phones connect through it too. Closing it also stops the clock sync.
 */
export const connectDevice = ({
  url,
  clientInfo,
  clockSync,
  onPlayback,
  onLiveChange,
  log,
  deviceState = () => NO_DEVICE_STATE,
  takePhraseReports,
  onChunk,
  WebSocketImpl
}: DeviceConnectionOptions) => {
  // The clock sync's own clock, so the lead and the offset it is added to are on one clock.
  const now = () => clockSync.now()
  let openedAt = now()
  let lastChunk: PhoneReport['lastChunk'] = null

  /** The phone's state now: what the connection knows, and what the device says about itself. */
  const report = (): PhoneReport => {
    const estimate = clockSync.clock.estimate()
    return {
      clock: estimate && { ...estimate, connectedForMs: now() - openedAt },
      ...deviceState(),
      lastChunk,
      tts: takePhraseReports ? takePhraseReports() : null
    }
  }

  /**
   * Keeps the last chunk with partials, and how early it came by the clock as it
   * stood when it arrived. Runs after playback has the chunk, and a chunk whose
   * timing cannot be read is only left out of the report.
   */
  const noteChunk = (message: object) => {
    if (!isChunkEnvelope(message)) return
    let arrival: ChunkArrival | null = null
    try {
      const timing = chunkTiming(message)
      if (timing) {
        arrival = {
          chunk: timing.chunk,
          leadMs: chunkLeadMs(timing.soundsAtServerMs, now(), clockSync.clock.estimate()?.offsetMs ?? null)
        }
        lastChunk = { index: arrival.chunk, leadMs: arrival.leadMs }
      }
    } catch (err) {
      console.warn('Could not read the timing of a chunk:', err)
    }
    onChunk?.(message, arrival)
  }

  const socket = createResilientSocket({
    url,
    onOpen: (send) => {
      openedAt = now()
      clockSync.start((message) => send(JSON.stringify(message)), report)
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
      noteChunk(message)
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
