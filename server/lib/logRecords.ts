/**
 * What the log files record: a performance's file of what happened during it,
 * one JSON object per line, for working out afterwards what went wrong on which
 * phone, and the server-wide file of connections that belong to no performance
 * yet. Both are written as record logs (lib/recordLog.ts).
 */

import { DroppedRecord, RecordLog } from './recordLog'

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
  /** What a registered device's connection recorded while it belonged to this performance. */
  | ConnectionRecord
  /** A registered device said it plays another performance or became an admin, so its records go elsewhere from now on. */
  | { type: 'disconnect'; connection: string; reason: 'switched' }
  /** An admin started a track. */
  | { type: 'start'; trackId: string; loop: boolean; startAtChunk: number }
  /** An admin stopped the track that was playing. */
  | { type: 'stop'; trackId: string }
  /** A looping track ran past its end and began again. */
  | { type: 'loop'; trackId: string }
  /**
   * A chunk went out: how late against the schedule sending it started, how long
   * sending it to every device took, to how many devices, and how many of its
   * partials no device was given.
   */
  | { type: 'chunk'; index: number; lateMs: number; sendMs: number; devices: number; unassignedPartials: number }
  /** A track that does not loop ran out. */
  | { type: 'ended'; trackId: string }
  /** Lines before this one were lost because they could not be written; written by the log itself. */
  | DroppedRecord

/**
 * Something the server-wide log records: what happens to a connection while its
 * records go to no performance's file. Each carries the connection id its performance's
 * records carry later, so the two files can be read together.
 */
export type ServerRecord =
  /** A socket opened. */
  | { type: 'connect'; connection: string }
  /**
   * How loaded the server was since the sample before (lib/serverHealth.ts): how
   * far past schedule its event loop ran timers on average and at most, its CPU
   * as a percent of one core, its memory, and the sockets open now.
   */
  | {
      type: 'health'
      eventLoopMeanMs: number
      eventLoopMaxMs: number
      cpuPct: number
      heapUsedMb: number
      rssMb: number
      sockets: number
    }
  /**
   * What a connection recorded while its records went to no performance's file:
   * one that never registered, an admin, or a device whose performance does not
   * exist, is still being looked up, or that it switched away from.
   */
  | ConnectionRecord
  /** Lines before this one were lost because they could not be written; written by the log itself. */
  | DroppedRecord

/**
 * Something a connection records in whichever file its records go to when it
 * happens (services/connectionLog.ts decides which).
 */
export type ConnectionRecord =
  /**
   * The socket sent one of the messages the server accepts, named in `message`,
   * in a shape it cannot read, so the message was ignored. A clientInfo ignored
   * this way leaves the device as it was: unregistered if it had not registered,
   * in its earlier performance if it had.
   */
  | { type: 'malformedMessage'; connection: string; message: string }
  /** The socket closed: by the device or the network, or because the heartbeat gave up on it. */
  | Disconnect

/** Why a socket closed: `heartbeat` when the server gave up on a peer that went quiet, `closed` for everything else. */
export type CloseReason = 'closed' | 'heartbeat'

/** A socket closed, with its close code. */
type Disconnect = { type: 'disconnect'; connection: string; reason: CloseReason; code: number }

/** The log of one performance. */
export type PerformanceLog = RecordLog<PerformanceRecord>

/** The server-wide log. */
export type ServerLog = RecordLog<ServerRecord>
