import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { agent } from './setupTests'
import { createTestPerformance, createTestTrack } from './testUtils'
import { performanceLogFiles } from '../services/performanceLogFiles'
import { SUPPORTED_PROTOCOL_VERSIONS, TrackDocument, UNVERSIONED_PROTOCOL_VERSION } from '../types'

/**
 * What a device already in the field receives, from its handshake to the end of
 * a track, for every version in the support window.
 *
 * See docs/wire-protocol.md for what the window promises and why these tests are
 * end to end rather than against the message builders.
 */

const ttsLang = { iso: 'en-US', lang: 'English' }

/** A socket that keeps every frame the server sent it, in order and unparsed. */
const openDevice = async () => {
  const port = (global.testWss.address() as WebSocket.AddressInfo).port
  const frames: string[] = []
  const ws = new WebSocket(`ws://localhost:${port}/`)

  ws.onmessage = (event) => frames.push(event.data.toString())

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = reject
  })

  return { ws, frames }
}

/** The frames that are JSON, parsed, in the order they arrived. */
const messages = (frames: string[]) =>
  frames.flatMap((frame) => {
    try {
      return [JSON.parse(frame)]
    } catch {
      return []
    }
  })

/** The handshake a build speaking this version sends. Version 1 carries none. */
const handshakeFor = (version: number, performanceId: string) => ({
  message: 'clientInfo',
  clientId: 0,
  ttsLang,
  performanceId,
  ...(version === UNVERSIONED_PROTOCOL_VERSION ? {} : { protocolVersion: version })
})

/** Waits for the server to have sent something, or fails saying what was missing. */
const waitFor = async <T>(what: string, read: () => T | undefined, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = read()
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`)
}

for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
  describe(`what a device speaking protocol v${version} receives`, () => {
    it('is acknowledged, and told how often to sync its clock', { timeout: 20000 }, async () => {
      const { ws, frames } = await openDevice()

      try {
        ws.send(JSON.stringify(handshakeFor(version, new Types.ObjectId().toString())))
        await waitFor('the handshake reply', () => frames.length >= 2 || undefined)

        // A device only starts syncing once it has been told the cadence, so a
        // build that is not sent this plays out of time with the rest of the room.
        expect(frames[0]).toBe('clientInfoReceived')
        expect(JSON.parse(frames[1])).toEqual({
          message: 'measureConfig',
          config: { intervalMs: expect.any(Number) }
        })
      } finally {
        ws.close()
      }
    })

    it(
      'is asked to report on its state with each ping while the server logs only if it speaks a version that can',
      { timeout: 20000 },
      async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-log-'))
        performanceLogFiles.writeTo(dir)
        const { ws, frames } = await openDevice()

        try {
          ws.send(JSON.stringify(handshakeFor(version, new Types.ObjectId().toString())))
          await waitFor('the handshake reply', () => frames.length >= 2 || undefined)

          expect(JSON.parse(frames[1]).config).toEqual(
            version >= 3 ? { intervalMs: expect.any(Number), report: true } : { intervalMs: expect.any(Number) }
          )
        } finally {
          ws.close()
          performanceLogFiles.writeTo(null)
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }
    )

    it('gets its clock-sync ping stamped and echoed back', { timeout: 20000 }, async () => {
      const { ws, frames } = await openDevice()

      try {
        ws.send(JSON.stringify(handshakeFor(version, new Types.ObjectId().toString())))
        await waitFor('registration', () => frames.includes('clientInfoReceived') || undefined)

        ws.send(JSON.stringify({ message: 'measure', t0: 1234 }))

        const response = await waitFor('the clock-sync response', () =>
          messages(frames).find((message) => message.message === 'measureResponse')
        )

        expect(response).toEqual({
          message: 'measureResponse',
          t0: 1234,
          serverRecv: expect.any(Number),
          serverSend: expect.any(Number)
        })
      } finally {
        ws.close()
      }
    })

    it('is announced to, sent its audio, and told when the track ends', { timeout: 30000 }, async () => {
      const track: TrackDocument = await createTestTrack('partials')
      const performanceId = await createTestPerformance()
      await agent
        .post('/api/add-tracks-to-performance')
        .send({ trackIds: [track._id], performanceId })
        .expect(201)

      const { ws, frames } = await openDevice()

      try {
        ws.send(JSON.stringify(handshakeFor(version, performanceId.toString())))
        await waitFor('registration', () => frames.includes('clientInfoReceived') || undefined)

        await agent.post('/api/track/start').send({ trackId: track._id, performanceId }).expect(200)

        const envelope = await waitFor('a chunk envelope', () => messages(frames).find((message) => message.chunk))

        // The device zeroes its playback offset on the announcement, so it has to
        // arrive before there is any audio to schedule against it.
        const sequence = messages(frames)
        const announced = sequence.findIndex((message) => message.start)
        expect(announced).toBeGreaterThanOrEqual(0)
        expect(sequence[announced]).toEqual({ start: true })
        expect(announced).toBeLessThan(sequence.findIndex((message) => message.chunk))

        expect(Object.keys(envelope).sort()).toEqual(['chunk', 'startTime', 'ttsRate', 'waveform'])
        expect(envelope).toMatchObject({ startTime: expect.any(Number), waveform: 'sine', ttsRate: 1 })

        // Choir mode, registered as choir id 0: the partial written for that voice.
        expect(envelope.chunk.partials).toEqual([
          {
            index: 0,
            startTime: expect.any(Number),
            endTime: expect.any(Number),
            breakpoints: expect.arrayContaining([{ time: expect.any(Number), freq: expect.any(Number), amp: expect.any(Number) }])
          }
        ])

        await agent.post('/api/track/stop').send({ performanceId }).expect(200)

        // Without this a device plays on with whatever it last scheduled.
        const stopped = await waitFor('the stop announcement', () => messages(frames).find((message) => message.stop))
        expect(stopped).toEqual({ stop: true })
      } finally {
        await agent.post('/api/track/stop').send({ performanceId })
        ws.close()
      }
    })
  })
}
