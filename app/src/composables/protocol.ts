/** Wire protocol versioning, device side. See docs/wire-protocol.md. */

/** The protocol version this app build speaks. */
export const PROTOCOL_VERSION = 3

/** Client → server: the handshake identifying this device and what it speaks. */
export interface ClientInfoMessage {
  message: 'clientInfo'
  clientId: number
  ttsLang: { iso: string; lang: string }
  performanceId: string
  protocolVersion: number
  /** Who the phone is, from protocol version 3 on. */
  device?: DeviceIdentity
}

/**
 * Who a phone is: the same `id` on every connection of one installation of the
 * app, and the app, system and network it runs on when it connects.
 */
export interface DeviceIdentity {
  id: string
  appVersion: string
  appBuild: string
  platform: string
  osVersion: string
  model: string
  network: string
}

/** Builds the handshake this build sends when the socket opens. */
export const buildClientInfoMessage = (client: Omit<ClientInfoMessage, 'message' | 'protocolVersion'>): ClientInfoMessage => ({
  message: 'clientInfo',
  ...client,
  protocolVersion: PROTOCOL_VERSION
})
