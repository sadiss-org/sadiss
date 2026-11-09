import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { performanceLogs } from '../services/performanceLogs'
import { startWebSocketServer } from '../services/webSocketService'
import { SadissWebSocketServer } from '../lib/SadissWebsocket'
import { CURRENT_PROTOCOL_VERSION, TrackDocument } from '../types'

/**
 * The performance log file, written by the running server: devices joining and
 * leaving, and a track an admin starts that runs out on its own.
 */

const ttsLang = { iso: 'en-US', lang: 'English' }

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-log-'))
  performanceLogs.writeTo(dir)
})

afterEach(() => {
  performanceLogs.writeTo(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A device socket on `wss`, keeping every frame it is sent. */
const openDevice = async (wss: SadissWebSocketServer, options: WebSocket.ClientOptions = {}) => {
  const port = (wss.address() as WebSocket.AddressInfo).port
  const frames: string[] = []
  const ws = new WebSocket(`ws://localhost:${port}/`, options)

  ws.on('message', (data) => frames.push(data.toString()))
  ws.on('error', () => {
    /* being hung up on surfaces as an error on the client */
  })

  await new Promise<void>((resolve) => ws.on('open', () => resolve()))

  return { ws, frames }
}

/** Says which performance the device plays, as a current build does, and waits to be acknowledged. */
const register = async (device: { ws: WebSocket; frames: string[] }, performanceId: string, choirId: number) => {
  device.ws.send(
    JSON.stringify({
      message: 'clientInfo',
      clientId: choirId,
      ttsLang,
      performanceId,
      protocolVersion: CURRENT_PROTOCOL_VERSION
    })
  )
  await waitFor('registration', () => device.frames.includes('clientInfoReceived') || undefined)
}

const waitFor = async <T>(what: string, read: () => T | undefined, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = read()
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`)
}

/** The records in a performance's log file so far. */
const recordsOf = (performanceId: string): any[] => {
  const file = path.join(dir, `performance-${performanceId}.jsonl`)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const waitForRecords = (performanceId: string, count: number) =>
  waitFor(`${count} records`, () => {
    const records = recordsOf(performanceId)
    return records.length >= count ? records : undefined
  })

describe('the performance log file', () => {
  it('records two devices joining, a track playing out, and the devices leaving, in order', { timeout: 30000 }, async () => {
    const track: TrackDocument = await createTestTrack('partials')
    const performanceId = (await createTestPerformance()).toString()
    await agent
      .post('/api/add-tracks-to-performance')
      .send({ trackIds: [track._id], performanceId })
      .expect(201)

    const soprano = await openDevice(global.testWss)
    const alto = await openDevice(global.testWss)

    await register(soprano, performanceId, 0)
    await register(alto, performanceId, 1)

    await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)
    await waitFor('the stop announcement', () => soprano.frames.find((frame) => frame === '{"stop":true}'))

    soprano.ws.close()
    alto.ws.close()

    const records = await waitForRecords(performanceId, 6)

    expect(records.map((record) => record.type)).toEqual(['register', 'register', 'start', 'ended', 'disconnect', 'disconnect'])
    expect(records[0]).toEqual({
      t: expect.any(Number),
      type: 'register',
      connection: expect.any(String),
      openedAt: expect.any(Number),
      choirId: 0,
      ttsLang,
      protocolVersion: CURRENT_PROTOCOL_VERSION
    })
    expect(records[1]).toMatchObject({ choirId: 1 })
    expect(records[2]).toEqual({ t: expect.any(Number), type: 'start', trackId: String(track._id), loop: false, startAtChunk: 0 })
    expect(records[3]).toEqual({ t: expect.any(Number), type: 'ended', trackId: String(track._id) })
    expect(records.slice(4)).toEqual([
      { t: expect.any(Number), type: 'disconnect', connection: expect.any(String), reason: 'closed', code: 1005 },
      { t: expect.any(Number), type: 'disconnect', connection: expect.any(String), reason: 'closed', code: 1005 }
    ])
    expect(new Set(records.slice(4).map((record) => record.connection))).toEqual(
      new Set(records.slice(0, 2).map((record) => record.connection))
    )
    for (let i = 1; i < records.length; i++) {
      expect(records[i].t).toBeGreaterThanOrEqual(records[i - 1].t)
    }
  })

  it('records that the heartbeat gave up on a device that went quiet', { timeout: 10000 }, async () => {
    const wss = startWebSocketServer(0, { heartbeat: { tickMs: 20, quiet: { pingAfterMs: 60, idleTimeoutMs: 200 } } })
    const performanceId = new Types.ObjectId().toString()

    try {
      const device = await openDevice(wss, { autoPong: false })
      await register(device, performanceId, 0)

      const records = await waitFor(
        'the disconnect',
        () => {
          const written = recordsOf(performanceId)
          return written.length >= 2 ? written : undefined
        },
        5000
      )

      expect(records[1]).toEqual({
        t: expect.any(Number),
        type: 'disconnect',
        connection: records[0].connection,
        reason: 'heartbeat',
        code: 1006
      })
    } finally {
      wss.close()
    }
  })

  it('closes a file after ten minutes without a record, and opens it again for the next one', async () => {
    const performanceId = new Types.ObjectId().toString()
    const log = performanceLogs.for(performanceId)
    const file = path.join(dir, `performance-${performanceId}.jsonl`)
    const movedAway = path.join(dir, 'moved-away.jsonl')

    log.write({ type: 'ended', trackId: 'first' })
    await waitForRecords(performanceId, 1)

    vi.advanceTimersByTime(11 * 60 * 1000)
    fs.renameSync(file, movedAway)
    log.write({ type: 'ended', trackId: 'second' })

    // Had the file stayed open, the second record would have followed it to its new name.
    expect((await waitForRecords(performanceId, 1)).map((record) => record.trackId)).toEqual(['second'])
    expect(fs.readFileSync(movedAway, 'utf8')).not.toContain('second')
  })

  it('records nothing for a socket that never says which performance it plays', { timeout: 10000 }, async () => {
    const device = await openDevice(global.testWss)
    device.ws.close()
    await new Promise((resolve) => device.ws.on('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(fs.readdirSync(dir)).toEqual([])
  })
})
