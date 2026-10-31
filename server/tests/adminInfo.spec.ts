import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { startWebSocketServer } from '../services/webSocketService'
import { SadissWebSocketServer } from '../lib/SadissWebsocket'
import { agent, authCookie } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { TrackDocument } from '../types'

/**
 * What the server keeps telling an admin about the room.
 *
 * The push that matters here is the repeating one, not the reply to the
 * handshake, so these tests run their own server with the interval turned
 * down far enough to see several pushes.
 */

const PUSH_INTERVAL_MS = 30

let servers: SadissWebSocketServer[] = []
let sockets: WebSocket[] = []

afterEach(() => {
  sockets.forEach((socket) => socket.close())
  servers.forEach((server) => server.close())
  sockets = []
  servers = []
})

/** A server pushing admin updates fast enough for a test to watch. */
const fastPushingServer = () => {
  const server = startWebSocketServer(0, { adminInfoIntervalMs: PUSH_INTERVAL_MS })
  servers.push(server)
  return server
}

/** Connects as an admin and collects the admin updates it is pushed. */
const watchAsAdmin = async (server: SadissWebSocketServer, performanceId?: string) => {
  const port = (server.address() as WebSocket.AddressInfo).port
  const socket = new WebSocket(`ws://localhost:${port}/`, { headers: { cookie: authCookie } })
  sockets.push(socket)

  const updates: any[] = []
  const others: any[] = []
  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString())
      if (parsed.message === 'adminInfo') updates.push(parsed.adminInfo)
      else others.push(parsed)
    } catch {
      // Non-JSON control frames are irrelevant here.
    }
  })

  await new Promise((resolve) => socket.on('open', resolve))
  socket.send(JSON.stringify(performanceId ? { message: 'isAdmin', performanceId } : { message: 'isAdmin' }))

  return {
    /** Every message that was not an admin update. */
    others,
    /** The updates pushed after the reply to the handshake. */
    repeated: async () => {
      await new Promise((resolve) => setTimeout(resolve, PUSH_INTERVAL_MS * 4))
      return updates.slice(1)
    }
  }
}

describe('the updates an admin is pushed', () => {
  /**
   * An admin on the dashboard has no performance. Answering it with the counts
   * for one would say there are no devices, which is a different claim.
   */
  it('says nothing about a performance to an admin that named none', async () => {
    const admin = await watchAsAdmin(fastPushingServer())

    const updates = await admin.repeated()

    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update).not.toHaveProperty('clientsConnectedToPerformanceByChoirId')
      expect(update).not.toHaveProperty('clientsConnectedToPerformanceByProtocolVersion')
    }
  })

  it('keeps reporting the room to an admin that named a performance', async () => {
    const admin = await watchAsAdmin(fastPushingServer(), String(await createTestPerformance()))

    const updates = await admin.repeated()

    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update).toHaveProperty('clientsConnectedToPerformanceByChoirId')
      expect(update).toHaveProperty('clientsConnectedToPerformanceByProtocolVersion')
    }
  })

  /**
   * The admin's view of playback is built from this push and nothing else, so it
   * has to carry the whole answer every time. See docs/wire-protocol.md.
   */
  describe('and where its performance has got to', () => {
    it('says nothing is playing when nothing is', async () => {
      const admin = await watchAsAdmin(fastPushingServer(), String(await createTestPerformance()))

      const updates = await admin.repeated()

      expect(updates.at(-1).playback).toEqual({ playing: false })
    })

    // Leaving the key out would mean a view showing a finished track has nothing
    // to correct it, which is the whole of #122.
    it('says so in every push, not only when the answer changes', async () => {
      const admin = await watchAsAdmin(fastPushingServer(), String(await createTestPerformance()))

      const updates = await admin.repeated()

      expect(updates.length).toBeGreaterThan(1)
      for (const update of updates) {
        expect(update.playback).toEqual({ playing: false })
      }
    })

    it('says nothing about playback to an admin that named no performance', async () => {
      const admin = await watchAsAdmin(fastPushingServer())

      const updates = await admin.repeated()

      for (const update of updates) {
        expect(update).not.toHaveProperty('playback')
      }
    })

    it('reports the track and the position while one is playing', { timeout: 30000 }, async () => {
      const track: TrackDocument = await createTestTrack('partials')
      const performanceId = await createTestPerformance()
      await agent.post('/api/add-tracks-to-performance').send({ trackIds: [track._id], performanceId }).expect(201)

      const admin = await watchAsAdmin(fastPushingServer(), performanceId.toString())

      try {
        await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)
        await new Promise((resolve) => setTimeout(resolve, 2500))

        const updates = await admin.repeated()
        const playing = updates.filter((update) => update.playback?.playing)

        expect(playing.length).toBeGreaterThan(0)
        expect(playing.at(-1).playback).toMatchObject({
          playing: true,
          trackId: String(track._id),
          totalChunks: expect.any(Number),
          loop: false
        })

        // The progress bar is drawn from this, so a position that never moves is
        // the same failure as no position at all.
        const positions = playing.map((update) => update.playback.chunkIndex)
        expect(Math.max(...positions)).toBeGreaterThan(Math.min(...positions))
      } finally {
        await agent.post('/api/track/stop').send({ performanceId })
      }
    })

    // A reconnecting admin is told the track ended by the next push, so it never
    // depends on having been listening at the moment it did.
    it('goes back to saying nothing is playing once the track is stopped', { timeout: 30000 }, async () => {
      const track: TrackDocument = await createTestTrack('partials')
      const performanceId = await createTestPerformance()
      await agent.post('/api/add-tracks-to-performance').send({ trackIds: [track._id], performanceId }).expect(201)

      const admin = await watchAsAdmin(fastPushingServer(), performanceId.toString())

      await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await agent.post('/api/track/stop').send({ performanceId }).expect(200)

      const updates = await admin.repeated()

      expect(updates.at(-1).playback).toEqual({ playing: false })
    })
  })

  it('is sent nothing else, even while its performance plays', { timeout: 30000 }, async () => {
    const track: TrackDocument = await createTestTrack('partials')
    const performanceId = await createTestPerformance()
    await agent.post('/api/add-tracks-to-performance').send({ trackIds: [track._id], performanceId }).expect(201)

    // The server the API plays through, so the admin is among the performance's listeners.
    const admin = await watchAsAdmin(global.testWss, performanceId.toString())

    await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await agent.post('/api/track/stop').send({ performanceId }).expect(200)
    // A stopped session notices on its next chunk.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(admin.others).toEqual([])
  })

  it('counts the devices that registered for the admin’s performance', async () => {
    const server = fastPushingServer()
    const performanceId = String(await createTestPerformance())
    const port = (server.address() as WebSocket.AddressInfo).port

    const device = new WebSocket(`ws://localhost:${port}/`)
    sockets.push(device)
    await new Promise((resolve) => device.on('open', resolve))
    device.send(
      JSON.stringify({ message: 'clientInfo', clientId: 3, ttsLang: { iso: 'en-US', lang: 'English' }, performanceId })
    )

    const admin = await watchAsAdmin(server, performanceId)
    const updates = await admin.repeated()

    expect(updates.at(-1).clientsConnectedToPerformanceByChoirId).toEqual({ 3: 1 })
  })
})
