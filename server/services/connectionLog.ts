import WebSocket from 'ws'
import { ConnectionRecord, PerformanceLog, PerformanceRecord, ServerLog } from '../lib/logRecords'
import { performanceOfDevice } from '../lib/audience'
import { SadissWebSocket } from '../lib/SadissWebsocket'
import { logger, reasonOf } from '../tools'

/**
 * Where a connection's records go, decided from the socket as it is at the
 * moment each one is written: to the file of the performance it plays, once its
 * register record has been written there, and to the server-wide file
 * otherwise. A register record is written only for a performance found to
 * exist: any socket can name any id, and only a real one may open a file. So a
 * performance's file shows every connection it has from its register on.
 *
 * A connection that leaves a performance's file, by naming another performance
 * or by becoming an admin, is recorded there as having switched, so every
 * connection a file shows ends in it.
 */

/** Whether a performance exists: yes, no, or undefined when that could not be found out. */
export type PerformanceLookup = (performanceId: string) => Promise<boolean | undefined>

/** The files records can go to. */
export interface LogFiles {
  for(performanceId: string): PerformanceLog
  server: ServerLog
}

/** What the log reads off a socket. */
export type Connection = Pick<
  SadissWebSocket,
  'id' | 'readyState' | 'performanceId' | 'isAdmin' | 'openedAt' | 'choirId' | 'ttsLang' | 'protocolVersion'
>

/** A connection record as a caller gives it: the log adds whose connection it is. */
type Unstamped<R> = R extends unknown ? Omit<R, 'connection'> : never

interface Logging {
  /** The performance whose file the connection last wrote to, empty for the server-wide file. */
  writtenUnder: string
  /** The performance whose file has this connection's register record, empty for none. */
  registeredUnder: string
  /** The performance id last looked up, with its answer to come. A failed lookup is forgotten, so the next clientInfo asks again. */
  lookup?: { performanceId: string; answer: Promise<boolean | undefined> }
}

export const createConnectionLog = (files: LogFiles, performanceExists: PerformanceLookup) => {
  const loggings = new WeakMap<Connection, Logging>()

  const loggingOf = (client: Connection) => {
    let logging = loggings.get(client)
    if (!logging) {
      logging = { writtenUnder: '', registeredUnder: '' }
      loggings.set(client, logging)
    }
    return logging
  }

  /**
   * The performance whose file the connection's next record goes to, empty for
   * the server-wide file. Records leaving a performance's file in that file.
   */
  const route = (client: Connection) => {
    const logging = loggingOf(client)
    const performanceId = performanceOfDevice(client) === logging.registeredUnder ? logging.registeredUnder : ''

    if (logging.writtenUnder && logging.writtenUnder !== performanceId) {
      files.for(logging.writtenUnder).write({ type: 'disconnect', connection: client.id, reason: 'switched' })
    }
    logging.writtenUnder = performanceId

    return performanceId
  }

  /** Looks the connection's performance up, or reuses the lookup already made for it. */
  const lookUp = (logging: Logging, performanceId: string) => {
    if (logging.lookup?.performanceId === performanceId) return logging.lookup.answer

    const lookup = {
      performanceId,
      answer: performanceExists(performanceId).then((exists) => {
        if (exists === undefined && logging.lookup === lookup) logging.lookup = undefined
        return exists
      })
    }
    logging.lookup = lookup
    return lookup.answer
  }

  /** Writes the register record once the performance the device names is found to exist. */
  const register = async (client: Connection) => {
    const logging = loggingOf(client)
    const performanceId = performanceOfDevice(client)
    if (performanceId !== logging.registeredUnder) logging.registeredUnder = ''
    route(client)
    if (!performanceId) return

    // What the device said now, not what a later clientInfo says by the time the answer comes.
    const record: Extract<PerformanceRecord, { type: 'register' }> = {
      type: 'register',
      connection: client.id,
      openedAt: client.openedAt,
      choirId: client.choirId,
      ttsLang: client.ttsLang,
      protocolVersion: client.protocolVersion
    }

    const exists = await lookUp(logging, performanceId)
    if (!exists || client.readyState !== WebSocket.OPEN || performanceOfDevice(client) !== performanceId) return

    logging.registeredUnder = performanceId
    files.for(route(client)).write(record)
  }

  return {
    /** A socket opened. It belongs to no performance yet. */
    opened: (client: Connection) => files.server.write({ type: 'connect', connection: client.id }),

    /** Writes a record of this connection wherever its records go now. */
    write: (client: Connection, record: Unstamped<ConnectionRecord>) => {
      const stamped: ConnectionRecord = { ...record, connection: client.id }
      const performanceId = route(client)
      ;(performanceId ? files.for(performanceId) : files.server).write(stamped)
    },

    /**
     * The socket said what it is: a device naming its performance, or an admin.
     * A device's register record follows once its performance is found to
     * exist, if the socket is still open and names it by then. Never throws.
     */
    identified: (client: Connection) => {
      register(client).catch((err: unknown) => logger.error(`Could not log the registration of ${client.id}: ${reasonOf(err)}`))
    }
  }
}

export type ConnectionLog = ReturnType<typeof createConnectionLog>
