/**
 * Device side of the clock-synchronization protocol. Mirrors the server
 * contracts in server/types/Measurement.ts. The device derives the shared clock
 * from each round trip; the server only stamps and echoes.
 */

/** Server-pushed clock-sync behaviour (cadence). */
export interface MeasurementConfig {
  /** Target interval (ms) between clock-sync round trips. */
  intervalMs: number
  /** Whether each ping carries a report on the phone's state. Absent, as from an older server, means no. */
  report?: boolean
}

/** Client → server: a clock-sync ping carrying the client send timestamp. */
export interface MeasureMessage {
  message: 'measure'
  t0: number
  /** The phone's state, when the server asked for it. */
  report?: PhoneReport
}

/**
 * The state of a phone at one clock-sync ping, for the performance log: how
 * well it keeps time, how its audio is scheduled and whether it is in the
 * foreground. A figure the phone cannot give is null.
 */
export interface PhoneReport {
  clock: {
    /** Its estimate of server time minus its own clock, in ms. */
    offsetMs: number
    /** The median of the faster half of its round trips, which the estimate uses, in ms. */
    rttMs: number
    /** How many round trips its window holds; the estimate uses the faster half. */
    roundTrips: number
    /** How long the current connection has been open, in ms. */
    connectedForMs: number
  } | null
  audio: {
    /** Server time minus audio-clock time, in s, as playback schedules with it. */
    scheduleOffsetS: number | null
    /** The output latency set on the calibration page, in s. */
    calibrationS: number
    state: string | null
    outputLatency: number | null
    baseLatency: number | null
    sampleRate: number | null
    outputTimestamp: { contextTime: number | null; performanceTime: number | null } | null
    /** How often the audio was built again because its clock stood still while running. */
    restarts: number
  } | null
  /** Whether the app is in the foreground. */
  visible: boolean | null
  /** Whether the silent sound that keeps audio alive with the screen off is playing. */
  keepAlivePlaying: boolean | null
  /** The last chunk with partials the phone was sent, and how long before its sound it arrived, in ms. */
  lastChunk: { index: number; leadMs: number | null } | null
  /** The TTS phrases finished since the last report, or null from a device that speaks none. */
  tts: PhraseReport[] | null
}

/** How one TTS phrase went. */
export interface PhraseReport {
  /** When the phrase is due in the track, in s. */
  trackTimeS: number
  /** The language the phrase was spoken in, or null for the engine's default voice. */
  lang: string | null
  rate: number
  /** How long after it was due by the audio clock the phone asked the engine to speak, in ms. */
  askedLateMs: number
  /** How long the engine took from being asked until it said it was done or failed, in ms. */
  tookMs: number
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

/** Any inbound message the controller may receive over the socket. */
export type InboundMeasurementMessage = MeasureResponseMessage | MeasureConfigMessage
