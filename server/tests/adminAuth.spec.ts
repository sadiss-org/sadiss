import WebSocket from 'ws'
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { agent, authCookie } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { readCookie } from '../lib/adminAuth'
import { TrackDocument } from '../types'
import { SadissPerformance } from '../models/sadissPerformance'

/**
 * Who may be told the state of a room.
 *
 * The websocket port is reachable from the internet and devices register on it
 * without credentials, so the admin handshake is the one place a login has to be
 * proved. See lib/adminAuth.ts.
 */

const wssPort = () => (global.testWss.address() as WebSocket.AddressInfo).port

/** Opens a socket, optionally carrying a login, and records what it is sent. */
const connect = async (cookie?: string) => {
  const messages: any[] = []
  const ws = new WebSocket(`ws://localhost:${wssPort()}/`, cookie ? { headers: { cookie } } : {})

  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()))
    } catch {
      // Non-JSON control frames are irrelevant here.
    }
  })

  await new Promise((resolve) => ws.on('open', resolve))

  return { ws, messages }
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))

describe('reading one cookie out of a header', () => {
  it('finds it wherever it sits among the others', () => {
    expect(readCookie('other=1; jwt=abc; another=2', 'jwt')).toBe('abc')
  })

  it('does not mistake a cookie whose name merely ends the same way', () => {
    expect(readCookie('notjwt=abc', 'jwt')).toBeUndefined()
  })

  it('has nothing to find when the request carried no cookies', () => {
    expect(readCookie(undefined, 'jwt')).toBeUndefined()
  })
})

describe('registering as an admin', () => {
  it('is refused when the connection carried no login', { timeout: 20000 }, async () => {
    const { ws, messages } = await connect()

    try {
      ws.send(JSON.stringify({ message: 'isAdmin', performanceId: new Types.ObjectId().toString() }))
      await settle()

      expect(messages).toEqual([])
    } finally {
      ws.close()
    }
  })

  it('is refused when the login does not verify', { timeout: 20000 }, async () => {
    const { ws, messages } = await connect('jwt=not-a-real-token')

    try {
      ws.send(JSON.stringify({ message: 'isAdmin' }))
      await settle()

      expect(messages).toEqual([])
    } finally {
      ws.close()
    }
  })

  /** What a logged-in admin is sent after asking to follow this performance. */
  const followAsLoggedIn = async (performanceId: string) => {
    const { ws, messages } = await connect(authCookie)

    try {
      ws.send(JSON.stringify({ message: 'isAdmin', performanceId }))
      await settle()
      return messages
    } finally {
      ws.close()
    }
  }

  const someoneElsesPerformance = async (isPublic: boolean) =>
    String(
      (await SadissPerformance.create({ name: 'not mine', creator: new Types.ObjectId(), isPublic }))._id
    )

  it('is granted for a performance of its own', { timeout: 20000 }, async () => {
    const messages = await followAsLoggedIn(String(await createTestPerformance(false)))

    expect(messages[0]).toMatchObject({ message: 'adminInfo' })
  })

  it("is granted for someone else's public performance", { timeout: 20000 }, async () => {
    const messages = await followAsLoggedIn(await someoneElsesPerformance(true))

    expect(messages[0]).toMatchObject({ message: 'adminInfo' })
  })

  it("is refused for someone else's private performance", { timeout: 20000 }, async () => {
    expect(await followAsLoggedIn(await someoneElsesPerformance(false))).toEqual([])
  })

  it('is refused for a performance that does not exist', { timeout: 20000 }, async () => {
    expect(await followAsLoggedIn(new Types.ObjectId().toString())).toEqual([])
    expect(await followAsLoggedIn('not-an-id')).toEqual([])
  })

  it('is granted without a performance, for the overall counts', { timeout: 20000 }, async () => {
    const { ws, messages } = await connect(authCookie)

    try {
      ws.send(JSON.stringify({ message: 'isAdmin' }))
      await settle()

      expect(messages[0]).toMatchObject({ message: 'adminInfo' })
    } finally {
      ws.close()
    }
  })

  // The refusal has to be more than a silent reply: an unregistered admin must
  // not go on receiving the pushes and the playback position either.
  it('leaves a refused connection out of the playback report', { timeout: 30000 }, async () => {
    const track: TrackDocument = await createTestTrack('partials')
    const performanceId = await createTestPerformance()
    await agent.post('/api/add-tracks-to-performance').send({ trackIds: [track._id], performanceId }).expect(201)

    const { ws, messages } = await connect()

    try {
      ws.send(JSON.stringify({ message: 'isAdmin', performanceId: performanceId.toString() }))
      await settle()

      await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)
      await settle(2500)

      expect(messages).toEqual([])
    } finally {
      await agent.post('/api/track/stop').send({ performanceId })
      ws.close()
    }
  })
})

describe('registering as a device', () => {
  // Devices are anonymous and have to stay that way: a phone has no account.
  it('still works with no login at all', { timeout: 20000 }, async () => {
    const frames: string[] = []
    const ws = new WebSocket(`ws://localhost:${wssPort()}/`)
    ws.on('message', (data) => frames.push(data.toString()))
    await new Promise((resolve) => ws.on('open', resolve))

    try {
      ws.send(
        JSON.stringify({
          message: 'clientInfo',
          clientId: 0,
          ttsLang: { iso: 'en-US', lang: 'English' },
          performanceId: new Types.ObjectId().toString()
        })
      )
      await settle()

      expect(frames[0]).toBe('clientInfoReceived')
    } finally {
      ws.close()
    }
  })
})
