import WebSocket from 'ws'
import { Types } from 'mongoose'
import { measurementService } from '../services/measurement'
import { logger } from '../tools'
import { authCookie } from './setupTests'
import { createTestPerformance } from './testUtils'

/** Opens a raw client socket to the test WS server. */
const connect = () =>
  new Promise<WebSocket>((resolve) => {
    const port = (global.testWss.address() as WebSocket.AddressInfo).port
    const ws = new WebSocket(`ws://localhost:${port}/`)
    ws.on('open', () => resolve(ws))
  })

/** Resolves with the first JSON message whose `message` field matches. */
const waitForMessage = (ws: WebSocket, message: string) =>
  new Promise<any>((resolve) => {
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.message === message) resolve(parsed)
      } catch {
        /* non-JSON control messages (e.g. 'clientInfoReceived') are ignored */
      }
    })
  })

describe('webSocketService measurement wiring', () => {
  it('answers a measure ping with a server-stamped measureResponse', async () => {
    const ws = await connect()
    const response = waitForMessage(ws, 'measureResponse')

    ws.send(JSON.stringify({ message: 'measure', t0: 12345 }))

    const msg = await response
    expect(msg.t0).toBe(12345)
    expect(typeof msg.serverRecv).toBe('number')
    expect(typeof msg.serverSend).toBe('number')
    ws.close()
  })

  it('pushes the clock-sync config when a client registers', async () => {
    const ws = await connect()
    const config = waitForMessage(ws, 'measureConfig')

    ws.send(
      JSON.stringify({
        message: 'clientInfo',
        clientId: 0,
        ttsLang: { iso: 'en-US', lang: 'English' },
        performanceId: new Types.ObjectId().toString()
      })
    )

    const msg = await config
    expect(typeof msg.config.intervalMs).toBe('number')
    ws.close()
  })
})

/**
 * The websocket port is open to anyone, so a frame that is not a message the
 * server understands has to be survivable. Each case is checked by having a
 * second client get an answer afterwards.
 */
describe('webSocketService with unusable frames', () => {
  it.each([
    ['a frame that is not JSON', 'this is not json'],
    ['a frame that is JSON but not an object', 'null'],
    ['an object with no message field', JSON.stringify({ t0: 1 })],
    ['an object whose message is not a string', JSON.stringify({ message: 7 })],
    // These name properties every object inherits, which a lookup by type used to find.
    ['a message type named __proto__', JSON.stringify({ message: '__proto__' })],
    ['a message type named valueOf', JSON.stringify({ message: 'valueOf' })],
    ['a message type named hasOwnProperty', JSON.stringify({ message: 'hasOwnProperty' })],
    ['a message type named constructor', JSON.stringify({ message: 'constructor' })]
  ])('keeps serving other clients after %s', async (_name, frame) => {
    const noisy = await connect()
    const other = await connect()
    const response = waitForMessage(other, 'measureResponse')

    noisy.send(frame)
    other.send(JSON.stringify({ message: 'measure', t0: 4242 }))

    expect((await response).t0).toBe(4242)
    noisy.close()
    other.close()
  })
})

describe('webSocketService with a message whose handling fails', () => {
  it('logs the failure and keeps serving, instead of ending the process', async () => {
    const errors = vi.spyOn(logger, 'error')
    const handleMeasure = measurementService.handleMeasure.bind(measurementService)
    const failing = vi.spyOn(measurementService, 'handleMeasure').mockImplementationOnce(() => {
      throw new Error('handler blew up')
    })
    const noisy = await connect()
    const other = await connect()
    const response = waitForMessage(other, 'measureResponse')

    noisy.send(JSON.stringify({ message: 'measure', t0: 1 }))
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1))
    failing.mockImplementation(handleMeasure)
    other.send(JSON.stringify({ message: 'measure', t0: 4343 }))

    expect((await response).t0).toBe(4343)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('handler blew up'))
    failing.mockRestore()
    noisy.close()
    other.close()
  })
})

/**
 * ws rejects some frames before any message handler sees them, and reports it
 * as an error on the socket. Each case is checked by having a second client get
 * an answer afterwards.
 */
describe('webSocketService with frames ws cannot read', () => {
  it('keeps serving other clients after a text frame that is not valid UTF-8', async () => {
    const noisy = await connect()
    noisy.on('error', () => undefined)
    const closed = new Promise<number>((resolve) => noisy.on('close', resolve))
    const other = await connect()
    const response = waitForMessage(other, 'measureResponse')

    // ws sends these bytes as a text frame without checking them.
    noisy.send(Buffer.from([0xff]), { binary: false })
    expect(await closed).toBe(1007)
    other.send(JSON.stringify({ message: 'measure', t0: 4444 }))

    expect((await response).t0).toBe(4444)
    other.close()
  })

  it('closes a connection that sends a frame far larger than any message, and keeps serving', async () => {
    const noisy = await connect()
    noisy.on('error', () => undefined)
    const closed = new Promise<number>((resolve) => noisy.on('close', resolve))
    const other = await connect()
    const response = waitForMessage(other, 'measureResponse')

    noisy.send('x'.repeat(1024 * 1024))
    expect(await closed).toBe(1009)
    other.send(JSON.stringify({ message: 'measure', t0: 4545 }))

    expect((await response).t0).toBe(4545)
    other.close()
  })
})

describe('webSocketService with an admin registration whose handling fails', () => {
  it('logs the failure and keeps serving, also after it has waited on the database', async () => {
    const errors = vi.spyOn(logger, 'error')
    const info = logger.info.bind(logger)
    // The line logged once the registration has been checked against the database.
    const failing = vi.spyOn(logger, 'info').mockImplementation((message: unknown, ...rest: unknown[]) => {
      if (String(message).endsWith('is admin')) throw new Error('admin handling blew up')
      return info(String(message), ...rest)
    })
    const performanceId = String(await createTestPerformance())
    const port = (global.testWss.address() as WebSocket.AddressInfo).port
    const admin = new WebSocket(`ws://localhost:${port}/`, { headers: { cookie: authCookie } })
    await new Promise((resolve) => admin.on('open', resolve))
    const other = await connect()
    const response = waitForMessage(other, 'measureResponse')

    admin.send(JSON.stringify({ message: 'isAdmin', performanceId }))
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('admin handling blew up')))
    failing.mockRestore()
    other.send(JSON.stringify({ message: 'measure', t0: 4646 }))

    expect((await response).t0).toBe(4646)
    admin.close()
    other.close()
  })
})
