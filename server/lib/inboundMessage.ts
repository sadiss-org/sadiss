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

import { ClientInfoMessage, DeviceIdentity, MeasureMessage } from '../types'
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

const readMeasure = (frame: Frame): MeasureMessage | undefined =>
  isNumber(frame.t0) ? { message: 'measure', t0: frame.t0 } : undefined

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
