/**
 * Who a playback session is sending to.
 *
 * A session needs to know which connections belong to its performance and what
 * each of them wants to hear. It does not need the websocket server, and holding
 * one would mean every chunk it sends could only be observed through a real
 * socket.
 */

import { SadissWebSocketServer } from './SadissWebsocket'

/** One connection a session sends to. */
export interface Recipient {
  readonly id: string
  /** The voice this device was assigned, or -1 if it has not registered. */
  readonly choirId: number
  readonly ttsLang: { iso: string; lang: string }
  send(data: string): void
}

/**
 * The performance a connection plays as a device, as the id string the wire
 * carries. Empty for an admin, which is told where a performance has got to by
 * its own push, and for a connection that has not said. Who is sent a
 * performance's chunks and whose connection its log records are both read off
 * this.
 */
export const performanceOfDevice = (client: { performanceId: unknown; isAdmin: boolean }) =>
  client.isAdmin ? '' : String(client.performanceId)

/**
 * Reads the devices playing one performance off the websocket server.
 *
 * An admin watching the performance is not among them: it is told where the
 * performance has got to by its own push. See docs/wire-protocol.md.
 */
export const webSocketAudience =
  (wss: SadissWebSocketServer, performanceKey: string) => (): Recipient[] =>
    Array.from(wss.clients)
      .filter((client) => performanceOfDevice(client) === performanceKey)
      .map((client) => ({
        id: client.id,
        choirId: client.choirId,
        ttsLang: client.ttsLang,
        send: (data) => client.safeSend(data)
      }))
