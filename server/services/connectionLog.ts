import WebSocket from 'ws'
import { ConnectionRecord, PerformanceLog, ServerLog } from '../lib/performanceLog'
import { performanceOfDevice } from '../lib/audience'
import { SadissWebSocket } from '../lib/SadissWebsocket'

/**
 * Where a connection's records go, decided from the socket as it is at the
 * moment each one is written: to the file of the performance it belongs to,
 * once that performance is found to exist, and to the server-wide file
 * otherwise. Any socket can name any id, and only a real one may open a file.
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
type Connection = Pick<
  SadissWebSocket,
  'id' | 'readyState' | 'performanceId' | 'isAdmin' | 'openedAt' | 'choirId' | 'ttsLang' | 'protocolVersion'
>

/** A performance id looked up for one connection, and the answer once there is one. */
interface Lookup {
  performanceId: string
  answer: Promise<boolean | undefined>
  exists?: boolean
}

interface Logging {
  /** The performance whose file the connection last wrote to, empty for the server-wide file. */
  writtenUnder: string
  /** The last lookup that gave an answer or is still waiting for one. A failed lookup is forgotten, so the next clientInfo asks again. */
  lookup?: Lookup
}

export const createConnectionLog = (files: LogFiles, performanceExists: PerformanceLookup) => {
  const loggings = new WeakMap<Connection, Logging>()

  const loggingOf = (client: Connection) => {
    let logging = loggings.get(client)
    if (!logging) {
      logging = { writtenUnder: '' }
      loggings.set(client, logging)
    }
    return logging
  }

  /** The performance the connection's records go to now, or empty for none. */
  const performanceNow = (client: Connection, logging: Logging) => {
    const performanceId = performanceOfDevice(client)
    const lookup = logging.lookup
    return performanceId && lookup?.performanceId === performanceId && lookup.exists ? performanceId : ''
  }

  /** The file for the connection's next record. Records leaving a performance's file in that file. */
  const fileFor = (client: Connection) => {
    const logging = loggingOf(client)
    const performanceId = performanceNow(client, logging)

    if (logging.writtenUnder && logging.writtenUnder !== performanceId) {
      files.for(logging.writtenUnder).write({ type: 'disconnect', connection: client.id, reason: 'switched' })
    }
    logging.writtenUnder = performanceId

    return performanceId ? files.for(performanceId) : files.server
  }

  /** Looks the connection's performance up, or reuses the lookup already made for it. */
  const lookUp = (logging: Logging, performanceId: string) => {
    if (logging.lookup?.performanceId === performanceId) return logging.lookup.answer

    const lookup: Lookup = {
      performanceId,
      answer: performanceExists(performanceId).then((exists) => {
        lookup.exists = exists
        if (exists === undefined && logging.lookup === lookup) logging.lookup = undefined
        return exists
      })
    }
    logging.lookup = lookup
    return lookup.answer
  }

  return {
    /** A socket opened. It belongs to no performance yet. */
    opened: (client: Connection) => files.server.write({ type: 'connect', connection: client.id }),

    /** Writes a record wherever the connection's records go now. */
    write: (client: Connection, record: ConnectionRecord) => fileFor(client).write(record),

    /**
     * The socket said what it is: a device naming its performance, or an admin.
     * A device's register record is written once its performance is found to
     * exist, and only if the socket still names it and is open by then.
     */
    identified: async (client: Connection) => {
      fileFor(client)

      const performanceId = performanceOfDevice(client)
      if (!performanceId) return

      const exists = await lookUp(loggingOf(client), performanceId)
      if (!exists || client.readyState !== WebSocket.OPEN || performanceOfDevice(client) !== performanceId) return

      fileFor(client)
      files.for(performanceId).write({
        type: 'register',
        connection: client.id,
        openedAt: client.openedAt,
        choirId: client.choirId,
        ttsLang: client.ttsLang,
        protocolVersion: client.protocolVersion
      })
    }
  }
}

export type ConnectionLog = ReturnType<typeof createConnectionLog>
