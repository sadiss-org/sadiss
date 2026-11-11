/** Wire protocol versioning, server side. See docs/wire-protocol.md. */

/** The protocol version the server itself speaks. */
export const CURRENT_PROTOCOL_VERSION = 3

/** The version a handshake without a `protocolVersion` field is taken to speak. */
export const UNVERSIONED_PROTOCOL_VERSION = 1

/** Every version that must keep playing against this server. See docs/wire-protocol.md. */
export const SUPPORTED_PROTOCOL_VERSIONS = [1, 2, 3] as const

/** Client → server: the handshake identifying a device and what it speaks. */
export interface ClientInfoMessage {
  message: 'clientInfo'
  clientId: number
  ttsLang: { iso: string; lang: string }
  performanceId: string
  protocolVersion?: number
  /** Who the phone is, from protocol version 3 on. Only the performance log reads it. */
  device?: DeviceIdentity
}

/**
 * Who a phone is, as it says in its handshake: the same `id` on every
 * connection of one installation of the app, and the app, system and network
 * it runs on at the moment it connects. Every field is as the phone reports it.
 */
export interface DeviceIdentity {
  /** Made up once per installation and kept on the phone. */
  id: string
  appVersion: string
  appBuild: string
  /** 'ios', 'android' or 'web'. */
  platform: string
  osVersion: string
  model: string
  /** How the phone reached the network when it connected, such as 'wifi' or 'cellular'. */
  network: string
}

/** The protocol version a handshake announces, defaulting to the unversioned one. */
export const readProtocolVersion = (clientInfo: Pick<ClientInfoMessage, 'protocolVersion'>) =>
  clientInfo.protocolVersion ?? UNVERSIONED_PROTOCOL_VERSION
