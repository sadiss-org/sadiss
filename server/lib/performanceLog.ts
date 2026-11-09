/**
 * What the log files record: a performance's file of what happened during it,
 * one JSON object per line, for working out afterwards what went wrong on which
 * phone, and the server-wide file of connections that belong to no performance
 * yet. Both are written as record logs (lib/recordLog.ts), which also write a
 * `dropped` record wherever lines were lost.
 */

import { RecordLog } from './recordLog'

/** Something a performance's log records, told apart by `type`. */
export type PerformanceRecord =
  /** A device said which performance it plays, in which voice and language. */
  | {
      type: 'register'
      /** The server's id for this socket, new on every connection. */
      connection: string
      /** When the socket opened, in milliseconds on the server's clock. */
      openedAt: number
      choirId: number
      ttsLang: { iso: string; lang: string }
      protocolVersion: number
    }
  /** A registered device's socket closed: by the device or the network, or because the heartbeat gave up on it. */
  | Disconnect
  /** A registered device said it plays another performance, so its records go elsewhere from now on. */
  | { type: 'disconnect'; connection: string; reason: 'switched' }
  /** An admin started a track. */
  | { type: 'start'; trackId: string; loop: boolean; startAtChunk: number }
  /** An admin stopped the track that was playing. */
  | { type: 'stop'; trackId: string }
  /** A looping track ran past its end and began again. */
  | { type: 'loop'; trackId: string }
  /** A track that does not loop ran out. */
  | { type: 'ended'; trackId: string }

/**
 * Something the server-wide log records: what happens to a connection while its
 * records go to no performance's file. Each carries the connection id its performance's
 * records carry later, so the two files can be read together.
 */
export type ServerRecord =
  /** A socket opened. */
  | { type: 'connect'; connection: string }
  /**
   * A socket sent one of the messages the server accepts, named in `message`, in
   * a shape it cannot read, so the message was ignored. A clientInfo ignored this
   * way leaves the device unregistered.
   */
  | { type: 'malformedMessage'; connection: string; message: string }
  /**
   * A socket closed whose records were not going to a performance's file: one
   * that never registered, an admin, or a device whose performance does not
   * exist, is still being looked up, or that it switched away from.
   */
  | Disconnect

/** Why a socket closed: `heartbeat` when the server gave up on a peer that went quiet, `closed` for everything else. */
export type CloseReason = 'closed' | 'heartbeat'

/** A socket closed, with its close code. */
type Disconnect = { type: 'disconnect'; connection: string; reason: CloseReason; code: number }

/** The log of one performance. */
export type PerformanceLog = RecordLog<PerformanceRecord>

/** The server-wide log. */
export type ServerLog = RecordLog<ServerRecord>
