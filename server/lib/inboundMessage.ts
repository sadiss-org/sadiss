/**
 * Reading a frame off the wire as one of the messages we accept.
 *
 * The websocket port is open to anyone and nothing upstream checks what arrives,
 * so this is where an arbitrary string becomes a value the rest of the server may
 * trust. Each message is rebuilt field by field rather than cast, which is what
 * makes the returned type true: a frame carrying extra keys loses them, and one
 * whose fields are the wrong shape is not returned at all.
 *
 * The predicates are deliberately the loosest that still keep the type honest.
 * Builds already on phones have to keep registering against a newer server — see
 * docs/wire-protocol.md — so a field is required here only if the server reads
 * it, and empty strings are accepted because a device given a QR code with no TTS
 * languages announces exactly that.
 */

import { ClientInfoMessage, DeviceIdentity, MeasureMessage, PhoneReport, PhraseReport } from '../types'
import { logger } from '../tools'

/** Client → server: an operator's interface asking to follow a performance. */
export interface AdminRegistrationMessage {
  message: 'isAdmin'
  performanceId?: string
}

/** Everything the server accepts over the websocket. */
export type InboundMessage = ClientInfoMessage | MeasureMessage | AdminRegistrationMessage

type Frame = Record<string, unknown>

const isFrame = (value: unknown): value is Frame => typeof value === 'object' && value !== null

const isTtsLang = (value: unknown): value is { iso: string; lang: string } =>
  isFrame(value) && typeof value.iso === 'string' && typeof value.lang === 'string'

const isOptional = <T>(value: unknown, is: (candidate: unknown) => candidate is T): value is T | undefined =>
  value === undefined || is(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'

/** The longest a field of a phone's identity may be; a longer one is not a real identity. */
const MAX_DEVICE_TEXT = 100

const isDeviceText = (value: unknown): value is string => isString(value) && value.length <= MAX_DEVICE_TEXT

/** A phone's identity, or nothing when any field is missing, not a string, or longer than a real one. */
const readDevice = (value: unknown): DeviceIdentity | undefined => {
  if (!isFrame(value)) return undefined
  const { id, appVersion, appBuild, platform, osVersion, model, network } = value
  if (
    isDeviceText(id) &&
    isDeviceText(appVersion) &&
    isDeviceText(appBuild) &&
    isDeviceText(platform) &&
    isDeviceText(osVersion) &&
    isDeviceText(model) &&
    isDeviceText(network)
  ) {
    return { id, appVersion, appBuild, platform, osVersion, model, network }
  }
  return undefined
}

const readClientInfo = (frame: Frame): ClientInfoMessage | undefined => {
  if (
    !isNumber(frame.clientId) ||
    !isTtsLang(frame.ttsLang) ||
    !isString(frame.performanceId) ||
    !isOptional(frame.protocolVersion, isNumber)
  ) {
    return undefined
  }

  // Only the log reads it, so a malformed one costs the log that detail, never the registration.
  const device = readDevice(frame.device)

  return {
    message: 'clientInfo',
    clientId: frame.clientId,
    ttsLang: frame.ttsLang,
    performanceId: frame.performanceId,
    protocolVersion: frame.protocolVersion,
    ...(device && { device })
  }
}

/** The longest text a report keeps, such as an audio context's state; anything longer is read as unknown. */
const MAX_REPORT_TEXT = 40

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const booleanOrNull = (value: unknown) => (typeof value === 'boolean' ? value : null)
const textOrNull = (value: unknown) => (typeof value === 'string' && value.length <= MAX_REPORT_TEXT ? value : null)

/** The most TTS phrases one report keeps; the app sends no more than this. */
const MAX_REPORTED_PHRASES = 20
/** The longest error a phrase report keeps; a longer one is cut to this. */
const MAX_PHRASE_ERROR = 200

const errorOrNull = (value: unknown) => (typeof value === 'string' ? value.slice(0, MAX_PHRASE_ERROR) : null)

/** The phrases of a report, each read figure by figure, or null from an app that sends none. */
const phrasesOrNull = (value: unknown): PhraseReport[] | null =>
  Array.isArray(value)
    ? value
        .filter(isFrame)
        .slice(0, MAX_REPORTED_PHRASES)
        .map((phrase) => ({
          trackTimeS: numberOrNull(phrase.trackTimeS),
          lang: textOrNull(phrase.lang),
          rate: numberOrNull(phrase.rate),
          askedLateMs: numberOrNull(phrase.askedLateMs),
          tookMs: numberOrNull(phrase.tookMs),
          error: errorOrNull(phrase.error)
        }))
    : null

/** A part of a report read with `read`, or null when the phone sent no object for it. */
const partOrNull = <T>(value: unknown, read: (part: Frame) => T): T | null => (isFrame(value) ? read(value) : null)

/**
 * A phone's report, rebuilt figure by figure: a figure of the wrong kind is read
 * as unknown rather than costing the rest. Nothing when it is not an object.
 */
const readPhoneReport = (value: unknown): PhoneReport | undefined => {
  if (!isFrame(value)) return undefined
  return {
    clock: partOrNull(value.clock, (clock) => ({
      offsetMs: numberOrNull(clock.offsetMs),
      rttMs: numberOrNull(clock.rttMs),
      roundTrips: numberOrNull(clock.roundTrips),
      connectedForMs: numberOrNull(clock.connectedForMs)
    })),
    audio: partOrNull(value.audio, (audio) => ({
      scheduleOffsetS: numberOrNull(audio.scheduleOffsetS),
      calibrationS: numberOrNull(audio.calibrationS),
      state: textOrNull(audio.state),
      outputLatency: numberOrNull(audio.outputLatency),
      baseLatency: numberOrNull(audio.baseLatency),
      sampleRate: numberOrNull(audio.sampleRate),
      outputTimestamp: partOrNull(audio.outputTimestamp, (stamp) => ({
        contextTime: numberOrNull(stamp.contextTime),
        performanceTime: numberOrNull(stamp.performanceTime)
      })),
      restarts: numberOrNull(audio.restarts)
    })),
    visible: booleanOrNull(value.visible),
    keepAlivePlaying: booleanOrNull(value.keepAlivePlaying),
    lastChunk: partOrNull(value.lastChunk, (chunk) => ({ index: numberOrNull(chunk.index), leadMs: numberOrNull(chunk.leadMs) })),
    tts: phrasesOrNull(value.tts)
  }
}

const readMeasure = (frame: Frame): MeasureMessage | undefined => {
  if (!isNumber(frame.t0)) return undefined
  // Only the log reads the report; the ping is the shared clock and is answered whatever the report holds.
  const report = readPhoneReport(frame.report)
  return { message: 'measure', t0: frame.t0, ...(report && { report }) }
}

const readAdminRegistration = (frame: Frame): AdminRegistrationMessage | undefined =>
  isOptional(frame.performanceId, isString)
    ? { message: 'isAdmin', performanceId: frame.performanceId }
    : undefined

// A Map, so a type sent by a client finds only these readers, never a property
// every object inherits, such as __proto__ or valueOf.
const readers = new Map<string, (frame: Frame) => InboundMessage | undefined>([
  ['clientInfo', readClientInfo],
  ['measure', readMeasure],
  ['isAdmin', readAdminRegistration]
])

/**
 * One of our messages, or nothing at all. Nothing is returned rather than thrown.
 * `onMalformed` hears the type of a message we accept that arrived in a shape we
 * cannot read.
 */
export const readInboundMessage = (
  raw: string,
  onMalformed: (message: string) => void = () => undefined
): InboundMessage | undefined => {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Discarded a frame that is not JSON: ${raw.slice(0, 200)}`)
    return undefined
  }

  if (!isFrame(parsed) || !isString(parsed.message)) {
    logger.warn(`Discarded a frame that is not a message: ${raw.slice(0, 200)}`)
    return undefined
  }

  const read = readers.get(parsed.message)
  if (!read) {
    logger.debug(`Ignored a message of an unknown type: ${parsed.message}`)
    return undefined
  }

  const message = read(parsed)
  if (!message) {
    logger.warn(`Discarded a malformed ${parsed.message} message: ${raw.slice(0, 200)}`)
    onMalformed(parsed.message)
  }

  return message
}
