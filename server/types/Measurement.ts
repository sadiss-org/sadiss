/**
 * Clock-synchronization protocol.
 *
 * The server is the clock authority. Every device derives the shared clock from
 * it by round-tripping over the existing WebSocket, following the classic NTP
 * four-timestamp scheme:
 *
 *   t0         client sends `measure`
 *   serverRecv server receives it          ┐ server clock
 *   serverSend server replies              ┘
 *   t3         client receives the reply
 *
 * From {t0, serverRecv, serverSend, t3} the device derives its offset from the
 * server clock and schedules audio against it. The server keeps no per-device
 * state: it only stamps and echoes. All estimation lives on the device.
 */

/**
 * Server-pushed clock-sync behaviour. Pushing it over the wire keeps the
 * device's round-trip cadence tunable without rebuilding the app.
 */
export interface MeasurementConfig {
  /** Target interval (ms) between clock-sync round trips. */
  intervalMs: number
  /** Present and true while devices are to send a report on their state with each ping. */
  report?: true
}

/** Client → server: a clock-sync ping carrying the client send timestamp. */
export interface MeasureMessage {
  message: 'measure'
  t0: number
  /** The phone's state, from protocol version 3 on, while the config asks for it. */
  report?: PhoneReport
}

/**
 * A phone's state at one clock-sync ping, as the app sends it
 * (app/src/types/measurement.ts), for the performance log. Every figure is as
 * the phone reports it, and null where it could not give it or sent something
 * of the wrong kind.
 */
export interface PhoneReport {
  clock: { offsetMs: number | null; rttMs: number | null; roundTrips: number | null; connectedForMs: number | null } | null
  audio: {
    scheduleOffsetS: number | null
    calibrationS: number | null
    state: string | null
    outputLatency: number | null
    baseLatency: number | null
    sampleRate: number | null
    outputTimestamp: { contextTime: number | null; performanceTime: number | null } | null
    /** How often the phone built its audio again because the audio clock stood still while running. */
    restarts: number | null
  } | null
  visible: boolean | null
  keepAlivePlaying: boolean | null
  lastChunk: { index: number | null; leadMs: number | null } | null
  /** The TTS phrases the phone finished since its last report, or null from an app that reports none. */
  tts: PhraseReport[] | null
}

/** How one TTS phrase went on a phone. */
export interface PhraseReport {
  /** When the phrase is due in the track, in s. */
  trackTimeS: number | null
  /** The language it was spoken in, or null for the engine's default voice. */
  lang: string | null
  rate: number | null
  /** How long after it was due by the phone's audio clock the phone asked its engine to speak, in ms. */
  askedLateMs: number | null
  /** How long the engine took from being asked until it said it was done or failed, in ms. */
  tookMs: number | null
  /** Why the engine did not speak it, or null when it did. */
  error: string | null
}

/** Server → client: the ping echoed back with server clock stamps. */
export interface MeasureResponseMessage {
  message: 'measureResponse'
  t0: number
  serverRecv: number
  serverSend: number
}

/** Server → client: the active clock-sync configuration. */
export interface MeasureConfigMessage {
  message: 'measureConfig'
  config: MeasurementConfig
}
