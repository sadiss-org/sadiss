import WebSocket from 'ws'
import { describe, it, expect } from 'vitest'
import { agent, authCookie } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { CURRENT_PROTOCOL_VERSION, TrackDocument } from '../types'

/**
 * The handshake carries the wire protocol version a device speaks, so the
 * server can tell app generations apart. A handshake without it is version 1.
 */

const wssPort = () => (global.testWss.address() as WebSocket.AddressInfo).port

/** Opens a client socket, sends the given clientInfo, resolves once registered. */
const connectClient = (clientInfo: Record<string, unknown>) => {
  const messages: any[] = []

  return new Promise<{ ws: WebSocket; messages: any[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${wssPort()}/`)
    ws.onopen = function () {
      this.send(JSON.stringify({ message: 'clientInfo', ...clientInfo }))
    }
    ws.onmessage = (event) => {
      const data = event.data.toString()
      if (data === 'clientInfoReceived') {
        resolve({ ws, messages })
        return
      }
      try {
        messages.push(JSON.parse(data))
      } catch {
        // Non-JSON control frames are irrelevant here.
      }
    }
    ws.onerror = reject
  })
}

/** Opens an admin socket for a performance and collects the adminInfo messages. */
const connectAdmin = (performanceId: string) =>
  new Promise<{ ws: WebSocket; adminInfos: any[] }>((resolve, reject) => {
    const adminInfos: any[] = []
    const ws = new WebSocket(`ws://localhost:${wssPort()}/`, { headers: { cookie: authCookie } })
    ws.onopen = function () {
      this.send(JSON.stringify({ message: 'isAdmin', performanceId }))
    }
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data.toString())
        if (parsed.message === 'adminInfo') {
          adminInfos.push(parsed.adminInfo)
          resolve({ ws, adminInfos })
        }
      } catch {
        // Non-JSON control frames are irrelevant here.
      }
    }
    ws.onerror = reject
  })

/** Polls a collected message list until one matches, or gives up. */
const waitFor = async <T>(read: () => T | undefined, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = read()
    if (found) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  return undefined
}

const ttsLang = { iso: 'en-US', lang: 'English' }

describe('protocol version in the client handshake', () => {
  it('serves audio to a client that sends no protocol version', { timeout: 20000 }, async () => {
    const track: TrackDocument = await createTestTrack('partials')
    const performanceId = await createTestPerformance()
    await agent.post('/api/add-tracks-to-performance').send({ trackIds: [track._id], performanceId }).expect(201)

    // Exactly the handshake an app built before protocol versioning sends.
    const { ws, messages } = await connectClient({ clientId: 0, ttsLang, performanceId: performanceId.toString() })

    try {
      await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)

      const chunkMessage = await waitFor(() => messages.find((m) => m?.chunk?.partials?.length))
      expect(chunkMessage).toBeDefined()
    } finally {
      await agent.post('/api/track/stop').send({ performanceId })
      ws.close()
    }
  })

  it('reports the protocol version of every connected client to admins', { timeout: 20000 }, async () => {
    const performanceId = String(await createTestPerformance())

    const legacy = await connectClient({ clientId: 0, ttsLang, performanceId })
    const current = await connectClient({ clientId: 1, ttsLang, performanceId, protocolVersion: 2 })
    const admin = await connectAdmin(performanceId)

    try {
      const info = await waitFor(() =>
        admin.adminInfos.find((candidate) => candidate.clientsConnectedToPerformanceByProtocolVersion)
      )
      expect(info.clientsConnectedToPerformanceByProtocolVersion).toEqual({ 1: 1, 2: 1 })
      // Without the server's own version, an admin cannot tell whether a room
      // that agrees on one version agrees on the current one.
      expect(info.serverProtocolVersion).toBe(CURRENT_PROTOCOL_VERSION)
    } finally {
      legacy.ws.close()
      current.ws.close()
      admin.ws.close()
    }
  })
})
