import WebSocket from 'ws'
import { progressOf, runningSessionCount } from './playbackService'
import { PlaybackProgress } from '../playbackSession'
import { logger } from '../tools'
import { ClientInfoMessage, CURRENT_PROTOCOL_VERSION, readProtocolVersion } from '../types'
import { measurementService } from './measurement'
import { performanceLogs } from './performanceLogs'
import { v4 as uuidv4 } from 'uuid'
import { SadissWebSocketServer, SadissWebSocket } from '../lib/SadissWebsocket'
import { AdminRegistrationMessage, readInboundMessage } from '../lib/inboundMessage'
import { authenticatedUserId } from '../lib/adminAuth'
import { SadissPerformance, visibleTo } from '../models/sadissPerformance'
import { isValidObjectId } from 'mongoose'
import {
  DEFAULT_TICK_MS,
  LIMITS_FOR_A_QUIET_PEER,
  limitsForReportingEvery,
  LivenessLimits,
  startHeartbeat
} from '../lib/heartbeat'

/**
 * How often each admin is told the state of the room and of its performance.
 *
 * This is the admin's only source of truth, so it runs at the granularity the
 * progress bar needs rather than at a polling interval: every push is the whole
 * state, and a lost one costs a second.
 */
const ADMIN_INFO_INTERVAL_MS = 1000

interface HeartbeatOptions {
  /** How often the connections are looked at. */
  tickMs: number
  /** How long a peer that only answers pings may stay silent. */
  quiet: LivenessLimits
}

interface WebSocketServerOptions {
  /** How closely connections are watched for liveness. */
  heartbeat?: HeartbeatOptions
  /** How often each admin is told the state of the room. */
  adminInfoIntervalMs?: number
}

/**
 * Starts a WebSocket server on the specified port.
 * @param port The port number to listen on. If not provided, a random port will be used.
 * @returns The WebSocket server instance.
 */
export const startWebSocketServer = (port = 0, options: WebSocketServerOptions = {}) => {
  const wss = new SadissWebSocketServer({ port })

  watchConnections(wss, options.heartbeat)
  startAdminInfoUpdates(wss, options.adminInfoIntervalMs ?? ADMIN_INFO_INTERVAL_MS)

  wss.on('connection', (client, request) => {
    request.socket.setKeepAlive(true, 60000) // Might help with idle connections. Main mechanism is the heartbeat.

    // Assign id to new connection, needed for nonChoir partial distribution
    client.id = uuidv4()
    client.userId = authenticatedUserId(request)
    logger.info(`New client connected! Assigned id: ${client.id} Total clients: ${wss.clients.size}`)

    setupClientEventHandlers(wss, client)
  })

  return wss
}

const setupClientEventHandlers = (wss: SadissWebSocketServer, client: SadissWebSocket) => {
  client.on('pong', handlePong(client))
  // ws reports a frame it cannot read, such as invalid UTF-8 or one over the
  // size limit, as an error, and closes the socket itself. Without a listener
  // the error would end the process.
  client.on('error', (err) =>
    logger.warn(`Closed client ${client.id}, which sent a frame that could not be read: ${err.message}`)
  )
  client.onclose = handleClose(client)
  client.onmessage = handleMessage(wss, client)
}

/**
 * Handles one frame from a client. Anyone can open a socket, and nothing above
 * this catches what it throws, so a failure here would end the process and drop
 * every phone. It costs the one frame instead, and is logged.
 */
const handleMessage = (wss: SadissWebSocketServer, client: SadissWebSocket) => (event: WebSocket.MessageEvent) => {
  client.lastSeenAt = Date.now()

  try {
    const parsed = readInboundMessage(event.data.toString())
    if (!parsed) {
      return
    }

    logger.debug(`Received message from ws client: ${parsed.message}`)

    switch (parsed.message) {
      case 'clientInfo':
        registerDevice(client, parsed)
        break
      case 'measure':
        client.reportsRegularly = true
        measurementService.handleMeasure(client, parsed)
        break
      case 'isAdmin':
        registerAdmin(wss, client, parsed).catch((err: unknown) => logHandlingFailure(client, err))
        break
    }
  } catch (err) {
    logHandlingFailure(client, err)
  }
}

const logHandlingFailure = (client: SadissWebSocket, err: unknown) => {
  logger.error(`Dropped a message from ${client.id} whose handling failed: ${err instanceof Error ? err.message : String(err)}`)
}

const registerDevice = (client: SadissWebSocket, clientInfo: ClientInfoMessage) => {
  client.choirId = clientInfo.clientId
  client.ttsLang = clientInfo.ttsLang
  client.performanceId = clientInfo.performanceId
  client.protocolVersion = readProtocolVersion(clientInfo)

  logger.info(
    `Performance ${client.performanceId}: Client ${client.id} registered with choir id ${client.choirId}, TTS lang ${client.ttsLang.iso} and protocol version ${client.protocolVersion}`
  )

  client.send('clientInfoReceived')
  // Tell the device how often to run the clock-sync round trip.
  client.send(JSON.stringify(measurementService.buildConfigMessage()))

  logOf(client)?.write({
    type: 'register',
    connection: client.id,
    openedAt: client.openedAt,
    choirId: client.choirId,
    ttsLang: client.ttsLang,
    protocolVersion: client.protocolVersion
  })
}

/** The log of the performance a device registered for. None for an admin, or a socket that never said. */
const logOf = (client: SadissWebSocket) =>
  client.performanceId && !client.isAdmin ? performanceLogs.for(client.performanceId) : undefined

/**
 * What an admin is given is the state of the room: how many devices are
 * connected, in which voices, and where a running track has got to. That is not
 * public, and the port this arrives on is, so a connection that opened without a
 * login is not made an admin, and one that names a performance follows it only
 * if that account may see it in its performance list.
 */
const registerAdmin = async (
  wss: SadissWebSocketServer,
  client: SadissWebSocket,
  registration: AdminRegistrationMessage
) => {
  if (!client.userId) {
    logger.warn(`Refused admin registration from client ${client.id}: the connection carried no valid login`)
    return
  }

  if (registration.performanceId && !(await mayFollow(client.userId, registration.performanceId))) {
    logger.warn(`Refused admin registration from client ${client.id}: performance ${registration.performanceId} is not visible to it`)
    return
  }

  client.isAdmin = true

  if (registration.performanceId) {
    client.performanceId = registration.performanceId
    logger.info(`Performance ${client.performanceId}: Client ${client.id} is admin`)
  }

  client.send(JSON.stringify(createAdminInfoMessage(wss, registration.performanceId)))
}

/** Refuses when the lookup fails: an operator without a progress bar is better than a stranger with one. */
const mayFollow = async (userId: string, performanceId: string) => {
  if (!isValidObjectId(performanceId)) return false

  try {
    return !!(await SadissPerformance.exists({ _id: performanceId, ...visibleTo(userId) }))
  } catch (err) {
    logger.error(`Failed checking whether performance ${performanceId} is visible to ${userId}:`, err)
    return false
  }
}

const handleClose = (client: SadissWebSocket) => (event: WebSocket.CloseEvent) => {
  logger.info(`Client has disconnected! id: ${client.id}`)
  logOf(client)?.write({ type: 'disconnect', connection: client.id, reason: client.closeReason, code: event.code })
}

const handlePong = (client: SadissWebSocket) => () => {
  client.lastSeenAt = Date.now()
}

/**
 * How long this connection may stay silent.
 *
 * A device that has run a clock-sync round trip has shown it reports on the
 * cadence the server set, so it is judged against that. Everything else — an
 * admin, or a device from a build that does not run clock sync — says nothing
 * until it is pinged, and is given the longer grace that needs.
 */
const limitsFor = (client: SadissWebSocket, quiet: LivenessLimits) =>
  client.reportsRegularly ? limitsForReportingEvery(measurementService.reportingIntervalMs()) : quiet

const watchConnections = (wss: SadissWebSocketServer, options?: HeartbeatOptions) =>
  startHeartbeat(
    () => wss.clients,
    (client) => {
      // The socket is already terminated, but ws reports the close only on a
      // later tick, so the reason set here is the one the close handler reads.
      client.closeReason = 'heartbeat'
      logger.info(`${client.isAdmin ? 'Admin' : 'Client'} went quiet and was given up on! id: ${client.id}`)
    },
    (client) => limitsFor(client, options?.quiet ?? LIMITS_FOR_A_QUIET_PEER),
    options?.tickMs ?? DEFAULT_TICK_MS
  )

/** Keeps every admin's view of the room up to date. */
const startAdminInfoUpdates = (wss: SadissWebSocketServer, intervalMs: number) => {
  const updates = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAdmin) {
        client.safeSend(JSON.stringify(createAdminInfoMessage(wss, client.performanceId)))
      }
    }
  }, intervalMs)

  // Don't let these updates alone keep the process alive: in production the HTTP/WS
  // server holds it open, but once those close (e.g. after a test run) the process
  // should be free to exit instead of hanging on this timer.
  updates.unref()

  return updates
}

const createAdminInfoMessage = (wss: SadissWebSocketServer, adminPerformanceId?: string) => {
  interface AdminInfo {
    activePerformancesCount: number
    connectedClientsCount: number
    serverProtocolVersion: number
    clientsConnectedToPerformanceByChoirId?: Record<string, number>
    clientsConnectedToPerformanceByProtocolVersion?: Record<string, number>
    playback?: PlaybackProgress
  }

  const adminInfo: AdminInfo = {
    activePerformancesCount: runningSessionCount(),
    connectedClientsCount: wss.clients.size,
    serverProtocolVersion: CURRENT_PROTOCOL_VERSION
  }

  if (adminPerformanceId) {
    const clientsConnectedToPerformance = Array.from(wss.clients).filter(
      (client) => client.performanceId === adminPerformanceId && client.choirId >= 0
    )

    adminInfo.clientsConnectedToPerformanceByChoirId = countBy(clientsConnectedToPerformance, (client) => client.choirId)
    adminInfo.clientsConnectedToPerformanceByProtocolVersion = countBy(
      clientsConnectedToPerformance,
      (client) => client.protocolVersion
    )

    // An admin that named a performance asked where it has got to, so silence is
    // not an answer: nothing playing has to be said, or a view left showing a
    // finished track has nothing to correct it.
    adminInfo.playback = progressOf(adminPerformanceId)
  }

  return {
    message: 'adminInfo',
    adminInfo
  }
}

/** Groups clients by a key and returns how many fall into each. */
const countBy = (clients: SadissWebSocket[], key: (client: SadissWebSocket) => number) =>
  clients.reduce((acc, client) => {
    acc[key(client)] = (acc[key(client)] || 0) + 1
    return acc
  }, {} as Record<string, number>)
