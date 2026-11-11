import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent, authCookie } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { performanceLogFiles } from '../services/performanceLogFiles'
import { SadissPerformance } from '../models/sadissPerformance'
import { startWebSocketServer } from '../services/webSocketService'
import { SadissWebSocketServer } from '../lib/SadissWebsocket'
import { CURRENT_PROTOCOL_VERSION, TrackDocument } from '../types'
import { logger } from '../tools'

/**
 * The performance log files, written by the running server: devices joining and
 * leaving, a track an admin starts that runs out on its own, and in the
 * server-wide file what happens to a connection before it belongs to a
 * performance.
 */

const ttsLang = { iso: 'en-US', lang: 'English' }

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-log-'))
  performanceLogFiles.writeTo(dir)
})

afterEach(() => {
  performanceLogFiles.writeTo(null)
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
  const acknowledged = device.frames.filter((frame) => frame === 'clientInfoReceived').length
  device.ws.send(
    JSON.stringify({
      message: 'clientInfo',
      clientId: choirId,
      ttsLang,
      performanceId,
      protocolVersion: CURRENT_PROTOCOL_VERSION
    })
  )
  await waitFor(
    'registration',
    () => device.frames.filter((frame) => frame === 'clientInfoReceived').length > acknowledged || undefined
  )
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

/** The records in a log file so far: a performance's, or the server-wide one. */
const recordsOf = (performanceId: string | 'server'): any[] => {
  const file = path.join(dir, performanceId === 'server' ? 'server.jsonl' : `performance-${performanceId}.jsonl`)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const waitForRecords = (performanceId: string | 'server', count: number) =>
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
    // A register record waits on the performance being looked up.
    await waitForRecords(performanceId, 2)

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
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      unidentified: true
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

    // Each connection opened before it registered, recorded in the server-wide file.
    const connects = recordsOf('server').filter((record) => record.type === 'connect')
    for (const registered of records.slice(0, 2)) {
      const connect = connects.find((record) => record.connection === registered.connection)
      expect(connect).toEqual({ t: expect.any(Number), type: 'connect', connection: registered.connection })
      expect(connect.t).toBeLessThanOrEqual(registered.t)
    }
  })

  it('records that the heartbeat gave up on a device that went quiet', { timeout: 10000 }, async () => {
    const wss = startWebSocketServer(0, { heartbeat: { tickMs: 20, quiet: { pingAfterMs: 60, idleTimeoutMs: 200 } } })
    const performanceId = (await createTestPerformance()).toString()

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
    const log = performanceLogFiles.for(performanceId)
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

  it(
    'records a socket that connects and closes without registering in the server-wide file only',
    { timeout: 10000 },
    async () => {
      const device = await openDevice(global.testWss)
      device.ws.close()

      const records = await waitForRecords('server', 2)
      const connection = records[0].connection

      expect(records).toEqual([
        { t: expect.any(Number), type: 'connect', connection },
        { t: expect.any(Number), type: 'disconnect', connection, reason: 'closed', code: 1005 }
      ])
      expect(fs.readdirSync(dir)).toEqual(['server.jsonl'])
    }
  )

  it(
    'records each message it cannot read, and a socket a malformed clientInfo left unregistered',
    { timeout: 10000 },
    async () => {
      const device = await openDevice(global.testWss)
      device.ws.send(JSON.stringify({ message: 'clientInfo', clientId: 'soprano', ttsLang, performanceId: 'x' }))
      device.ws.send(JSON.stringify({ message: 'measure', t0: 'now' }))
      device.ws.close()

      const records = await waitForRecords('server', 4)
      const connection = records[0].connection

      expect(records.map(({ t, ...record }) => record)).toEqual([
        { type: 'connect', connection },
        { type: 'malformedMessage', connection, message: 'clientInfo' },
        { type: 'malformedMessage', connection, message: 'measure' },
        { type: 'disconnect', connection, reason: 'closed', code: 1005 }
      ])
    }
  )

  it(
    'logs nothing under a performance id that names no performance, still answers the device, and records its close in the server-wide file',
    { timeout: 10000 },
    async () => {
      const unknown = new Types.ObjectId().toString()
      const device = await openDevice(global.testWss)

      await register(device, unknown, 0)
      await register(device, '../../not-an-id', 0)
      await waitFor('the clock-sync config', () => device.frames.find((frame) => frame.includes('measureConfig')))
      device.ws.close()

      const records = await waitForRecords('server', 2)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(device.frames.filter((frame) => frame === 'clientInfoReceived')).toHaveLength(2)
      expect(fs.readdirSync(dir)).toEqual(['server.jsonl'])
      expect(recordsOf('server').map(({ t, ...record }) => record)).toEqual([
        { type: 'connect', connection: records[0].connection },
        { type: 'disconnect', connection: records[0].connection, reason: 'closed', code: 1005 }
      ])
    }
  )

  it(
    'records the close of a device whose performance is still being looked up in the server-wide file',
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      const exists = SadissPerformance.exists.bind(SadissPerformance)
      // The socket goes while its performance is being looked up.
      vi.spyOn(SadissPerformance, 'exists').mockImplementationOnce((filter) => {
        for (const client of global.testWss.clients) if (client.performanceId === performanceId) client.terminate()
        return exists(filter)
      })
      const device = await openDevice(global.testWss)

      await register(device, performanceId, 0)

      const records = await waitForRecords('server', 2)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(records.map((record) => record.type)).toEqual(['connect', 'disconnect'])
      expect(recordsOf(performanceId)).toEqual([])
    }
  )

  it(
    'records a device that switches to another performance as having left the first, and its close where its records went next',
    { timeout: 10000 },
    async () => {
      const first = (await createTestPerformance()).toString()
      const unknown = new Types.ObjectId().toString()
      const device = await openDevice(global.testWss)

      await register(device, first, 0)
      await waitForRecords(first, 1)
      await register(device, unknown, 0)
      device.ws.close()

      const server = await waitForRecords('server', 2)
      const connection = server[0].connection
      expect(recordsOf(first).map(({ t, ...record }) => record)).toEqual([
        expect.objectContaining({ type: 'register', connection }),
        { type: 'disconnect', connection, reason: 'switched' }
      ])
      expect(server.map(({ t, ...record }) => record)).toEqual([
        { type: 'connect', connection },
        { type: 'disconnect', connection, reason: 'closed', code: 1005 }
      ])
    }
  )

  it(
    'says on the console why a performance could not be looked up, for a device and for an admin alike',
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      const errors = vi.spyOn(logger, 'error')
      vi.spyOn(SadissPerformance, 'exists').mockImplementation(() => {
        throw new Error('connection to the database was lost')
      })

      const device = await openDevice(global.testWss)
      await register(device, performanceId, 0)
      const admin = await openDevice(global.testWss, { headers: { Cookie: authCookie } })
      admin.ws.send(JSON.stringify({ message: 'isAdmin', performanceId }))

      await waitFor('both lookups to fail', () => (errors.mock.calls.length >= 2 ? true : undefined))
      expect(errors.mock.calls.map(([message]) => message)).toEqual([
        expect.stringMatching(/exists: connection to the database was lost$/),
        expect.stringMatching(/is visible to .*: connection to the database was lost$/)
      ])
      device.ws.close()
      admin.ws.close()
      // Both closes are recorded before the next test reads its files.
      await waitForRecords('server', 4)
    }
  )

  it('records the close of an admin in the server-wide file', { timeout: 10000 }, async () => {
    const performanceId = (await createTestPerformance()).toString()
    const admin = await openDevice(global.testWss, { headers: { Cookie: authCookie } })

    admin.ws.send(JSON.stringify({ message: 'isAdmin', performanceId }))
    await waitFor('the first admin info', () => admin.frames.find((frame) => frame.includes('adminInfo')))
    admin.ws.close()

    const records = await waitForRecords('server', 2)
    expect(records.map((record) => record.type)).toEqual(['connect', 'disconnect'])
    expect(recordsOf(performanceId)).toEqual([])
  })

  it(
    "records a message it cannot read from a registered device in that device's performance file",
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      const device = await openDevice(global.testWss)

      await register(device, performanceId, 0)
      await waitForRecords(performanceId, 1)
      device.ws.send(JSON.stringify({ message: 'measure', t0: 'now' }))
      device.ws.close()

      const records = await waitForRecords(performanceId, 3)
      const connection = records[0].connection
      expect(records.map(({ t, ...record }) => record)).toEqual([
        expect.objectContaining({ type: 'register', connection }),
        { type: 'malformedMessage', connection, message: 'measure' },
        { type: 'disconnect', connection, reason: 'closed', code: 1005 }
      ])
      expect(recordsOf('server').map((record) => record.type)).toEqual(['connect'])
    }
  )

  it(
    'looks a performance up again when the device sends its clientInfo again after a lookup that failed',
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      vi.spyOn(SadissPerformance, 'exists').mockImplementationOnce(() => {
        throw new Error('connection to the database was lost')
      })
      const device = await openDevice(global.testWss)

      await register(device, performanceId, 0)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await register(device, performanceId, 0)

      const records = await waitForRecords(performanceId, 1)
      expect(records.map((record) => record.type)).toEqual(['register'])
      device.ws.close()
      await waitForRecords(performanceId, 2)
    }
  )

  it(
    'records a device that becomes an admin as having left its performance, as soon as it does',
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      const device = await openDevice(global.testWss, { headers: { Cookie: authCookie } })

      await register(device, performanceId, 0)
      await waitForRecords(performanceId, 1)
      device.ws.send(JSON.stringify({ message: 'isAdmin', performanceId }))
      await waitFor('the first admin info', () => device.frames.find((frame) => frame.includes('adminInfo')))

      const records = await waitForRecords(performanceId, 2)
      expect(records.map(({ t, ...record }) => record)).toEqual([
        expect.objectContaining({ type: 'register', connection: records[0].connection }),
        { type: 'disconnect', connection: records[0].connection, reason: 'switched' }
      ])
      device.ws.close()
      await waitForRecords('server', 2)
    }
  )

  it(
    'opens no file for a performance id spelled other than an ObjectId prints, even one Mongo would match',
    { timeout: 10000 },
    async () => {
      const performanceId = (await createTestPerformance()).toString()
      const device = await openDevice(global.testWss)

      await register(device, performanceId.toUpperCase(), 0)
      await new Promise((resolve) => setTimeout(resolve, 200))
      device.ws.close()

      await waitForRecords('server', 2)
      expect(fs.readdirSync(dir)).toEqual(['server.jsonl'])
    }
  )

  it('records who a device is when it says, and that it did not when it does not', { timeout: 10000 }, async () => {
    const performanceId = (await createTestPerformance()).toString()
    const device = {
      id: '1f0e6c3a-6a5b-4c1e-9d55-3c1f2b7a9e10',
      appVersion: '2.2.0',
      appBuild: '12',
      platform: 'ios',
      osVersion: '18.1',
      model: 'iPhone14,5',
      network: 'cellular'
    }
    const identified = await openDevice(global.testWss)
    const unidentified = await openDevice(global.testWss)

    identified.ws.send(
      JSON.stringify({
        message: 'clientInfo',
        clientId: 0,
        ttsLang,
        performanceId,
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        device
      })
    )
    await waitForRecords(performanceId, 1)
    await register(unidentified, performanceId, 1)

    const records = await waitForRecords(performanceId, 2)
    expect(records[0]).toMatchObject({ type: 'register', choirId: 0, device })
    expect(records[0]).not.toHaveProperty('unidentified')
    expect(records[1]).toMatchObject({ type: 'register', choirId: 1, unidentified: true })
    expect(records[1]).not.toHaveProperty('device')
    identified.ws.close()
    unidentified.ws.close()
    await waitForRecords(performanceId, 4)
  })

  it('records no report from a socket that never said which device it is', { timeout: 10000 }, async () => {
    const device = await openDevice(global.testWss)
    const report = { clock: null, audio: null, visible: true, keepAlivePlaying: true, lastChunk: null }

    device.ws.send(JSON.stringify({ message: 'measure', t0: 42, report }))
    await waitFor('the answer', () => device.frames.find((frame) => frame.includes('measureResponse')))
    device.ws.close()

    const records = await waitForRecords('server', 2)
    expect(records.map((record) => record.type)).toEqual(['connect', 'disconnect'])
  })

  it('answers a ping whose report cannot be logged', { timeout: 10000 }, async () => {
    const performanceId = (await createTestPerformance()).toString()
    const device = await openDevice(global.testWss)
    await register(device, performanceId, 0)
    await waitForRecords(performanceId, 1)
    const files = performanceLogFiles.for.bind(performanceLogFiles)
    vi.spyOn(performanceLogFiles, 'for').mockImplementation((id) => ({
      write: (record) => {
        if (record.type === 'phone') throw new Error('disk on fire')
        files(id).write(record)
      }
    }))
    const report = { clock: null, audio: null, visible: true, keepAlivePlaying: true, lastChunk: null }

    device.ws.send(JSON.stringify({ message: 'measure', t0: 42, report }))

    const answer = await waitFor('the answer', () => device.frames.find((frame) => frame.includes('measureResponse')))
    expect(JSON.parse(answer)).toMatchObject({ t0: 42 })
    device.ws.close()
    await waitForRecords(performanceId, 2)
  })

  it("asks devices for reports while it logs, and records each report in the device's file", { timeout: 10000 }, async () => {
    const performanceId = (await createTestPerformance()).toString()
    const device = await openDevice(global.testWss)
    const deviceId = '1f0e6c3a-6a5b-4c1e-9d55-3c1f2b7a9e10'
    device.ws.send(
      JSON.stringify({
        message: 'clientInfo',
        clientId: 0,
        ttsLang,
        performanceId,
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        device: {
          id: deviceId,
          appVersion: '2.2.0',
          appBuild: '12',
          platform: 'android',
          osVersion: '13',
          model: 'MAR-LX1A',
          network: 'wifi'
        }
      })
    )
    await waitForRecords(performanceId, 1)
    const report = { clock: null, audio: null, visible: true, keepAlivePlaying: true, lastChunk: { index: 2, leadMs: 850 } }

    device.ws.send(JSON.stringify({ message: 'measure', t0: 42, report }))

    const config = await waitFor('the clock-sync config', () => device.frames.find((frame) => frame.includes('measureConfig')))
    expect(JSON.parse(config).config).toMatchObject({ report: true })
    await waitFor('the answer', () => device.frames.find((frame) => frame.includes('measureResponse')))
    const records = await waitForRecords(performanceId, 2)
    expect(records[1]).toEqual({ t: expect.any(Number), type: 'phone', connection: records[0].connection, deviceId, ...report })
    device.ws.close()
    await waitForRecords(performanceId, 3)
  })

  it('looks a performance up once for a device that sends the same clientInfo again', { timeout: 10000 }, async () => {
    const performanceId = (await createTestPerformance()).toString()
    const lookups = vi.spyOn(SadissPerformance, 'exists')
    const device = await openDevice(global.testWss)

    await register(device, performanceId, 0)
    await register(device, performanceId, 2)

    const records = await waitForRecords(performanceId, 2)
    expect(records.map((record) => [record.type, record.choirId])).toEqual([
      ['register', 0],
      ['register', 2]
    ])
    expect(lookups).toHaveBeenCalledTimes(1)
    device.ws.close()
  })

  it('creates the directory as soon as it is set, before any record', () => {
    const nested = path.join(dir, 'nested', 'logs')
    performanceLogFiles.writeTo(nested)

    expect(fs.statSync(nested).isDirectory()).toBe(true)
  })

  it('opens a file whose stream failed again a minute later, starting with how many records it missed', async () => {
    const performanceId = new Types.ObjectId().toString()
    const file = path.join(dir, `performance-${performanceId}.jsonl`)
    const log = performanceLogFiles.for(performanceId)

    // A directory where the file should be makes opening it fail.
    fs.mkdirSync(file)
    log.write({ type: 'ended', trackId: 'into the failing stream' })
    await new Promise((resolve) => setTimeout(resolve, 100))

    log.write({ type: 'ended', trackId: 'missed' })
    log.write({ type: 'ended', trackId: 'missed' })
    fs.rmdirSync(file)
    vi.advanceTimersByTime(30 * 1000)
    log.write({ type: 'ended', trackId: 'missed' })

    vi.advanceTimersByTime(31 * 1000)
    // The directory is made again in the background before the file is reopened.
    await waitFor('the reopened file', () => (fs.existsSync(file) && fs.readFileSync(file, 'utf8')) || undefined)
    log.write({ type: 'ended', trackId: 'after' })

    // The record that went into the stream before it failed is counted too.
    expect((await waitForRecords(performanceId, 2)).map(({ t, ...record }) => record)).toEqual([
      { type: 'dropped', count: 4 },
      { type: 'ended', trackId: 'after' }
    ])
  })

  it('creates a directory it could not create again a minute later, and says how many records it missed', async () => {
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, '')
    const logDir = path.join(blocker, 'logs')
    performanceLogFiles.writeTo(logDir)

    const performanceId = new Types.ObjectId().toString()
    const log = performanceLogFiles.for(performanceId)
    log.write({ type: 'ended', trackId: 'missed' })
    log.write({ type: 'ended', trackId: 'missed' })
    // Opening the file fails on its own time.
    await new Promise((resolve) => setTimeout(resolve, 100))

    fs.rmSync(blocker)
    vi.advanceTimersByTime(61 * 1000)

    const file = path.join(logDir, `performance-${performanceId}.jsonl`)
    await waitFor('the reopened file', () => (fs.existsSync(file) && fs.readFileSync(file, 'utf8')) || undefined)
    log.write({ type: 'ended', trackId: 'after' })

    const records = await waitFor('two records', () => {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      return lines.length >= 2 ? lines.map((line) => JSON.parse(line)) : undefined
    })
    expect(records.map(({ t, ...record }) => record)).toEqual([
      { type: 'dropped', count: 2 },
      { type: 'ended', trackId: 'after' }
    ])
  })

  it('makes the directory again without waiting on the disk, so a record written during a retry never blocks', async () => {
    fs.rmSync(dir, { recursive: true })
    const performanceId = new Types.ObjectId().toString()
    const log = performanceLogFiles.for(performanceId)
    const mkdirSync = vi.spyOn(fs, 'mkdirSync')

    log.write({ type: 'ended', trackId: 'missed' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    vi.advanceTimersByTime(61 * 1000)
    log.write({ type: 'ended', trackId: 'after' })

    expect(mkdirSync).not.toHaveBeenCalled()
    mkdirSync.mockRestore()
  })

  it('creates the directory again when it was removed, and says how many records it missed', async () => {
    fs.rmSync(dir, { recursive: true })
    const performanceId = new Types.ObjectId().toString()
    const log = performanceLogFiles.for(performanceId)

    log.write({ type: 'ended', trackId: 'missed' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    vi.advanceTimersByTime(61 * 1000)
    // The directory is made again in the background before the file is reopened.
    await waitForRecords(performanceId, 1)
    log.write({ type: 'ended', trackId: 'after' })

    expect((await waitForRecords(performanceId, 2)).map(({ t, ...record }) => record)).toEqual([
      { type: 'dropped', count: 1 },
      { type: 'ended', trackId: 'after' }
    ])
  })

  it('keeps a file that could not be written past ten minutes, until it has said how many records it missed', async () => {
    const performanceId = new Types.ObjectId().toString()
    const file = path.join(dir, `performance-${performanceId}.jsonl`)
    const log = performanceLogFiles.for(performanceId)

    fs.mkdirSync(file)
    log.write({ type: 'ended', trackId: 'missed' })
    // Each minute the file is tried again and fails again.
    for (let minute = 0; minute < 11; minute++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      vi.advanceTimersByTime(60 * 1000)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    fs.rmdirSync(file)
    vi.advanceTimersByTime(61 * 1000)

    expect((await waitForRecords(performanceId, 1)).map(({ t, ...record }) => record)).toEqual([{ type: 'dropped', count: 1 }])
  })
})
