import mongoose, { Types } from 'mongoose'
import { TrackDocument, TrackPerformanceDocument } from '../types'
import WebSocket from 'ws'
import { logger } from '../tools'
import { agent } from './setupTests'
import { vi } from 'vitest'

/**
 * Returns a MongoDB ObjectId. This is used to mock MongoDB ids in tests.
 */
export const generateMockId = () => new mongoose.Types.ObjectId()

// Helpers
export const createTestTrack = async (trackType: 'partials' | 'tts' | 'partialsAndTts' = 'partialsAndTts') => {
  const testTrack = {
    name: 'test track',
    mode: 'choir',
    waveform: 'sine',
    isPublic: true,
    ttsRate: '1.0',
    notes: 'test notes'
  }

  const req = agent
    .post('/api/track/create')
    .field('name', testTrack.name)
    .field('mode', testTrack.mode)
    .field('waveform', testTrack.waveform)
    .field('isPublic', testTrack.isPublic)
    .field('ttsRate', testTrack.ttsRate)
    .field('notes', testTrack.notes)

  if (trackType === 'partials') {
    req.attach('files', 'tests/testFiles/testPartialFile.txt', 'partialfile_testPartialFile')
  } else if (trackType === 'tts') {
    req.attach('files', 'tests/testFiles/testSrtFile.txt', 'ttsfile_0_en-US_testSrtFile')
  } else if (trackType === 'partialsAndTts') {
    req
      .attach('files', 'tests/testFiles/testPartialFile.txt', 'partialfile_testPartialFile')
      .attach('files', 'tests/testFiles/testSrtFile.txt', 'ttsfile_0_en-US_testSrtFile')
  }

  const resCreate: { body: TrackDocument } = await req.expect(201)

  return resCreate.body
}

export const createTestPerformance = async (isPublic = true) => {
  const testPerformance = {
    name: 'test performance',
    isPublic
  }

  const resCreate: { body: { _id: Types.ObjectId } } = await agent
    .post('/api/performance/create')!
    .send(testPerformance)
    .expect(201)

  return resCreate.body._id
}

export const createTestTrackPerformance = async (tracksToCreateCount = 1) => {
  const tracks: TrackDocument[] = []
  for (let i = 0; i < tracksToCreateCount; i++) {
    tracks.push(await createTestTrack())
  }
  const performanceId = await createTestPerformance()

  const res: { body: { trackPerformances: TrackPerformanceDocument[] } } = await agent
    .post('/api/add-tracks-to-performance')
    .send({
      trackIds: tracks.map((track) => track._id),
      performanceId
    })

  const trackPerformances = res.body.trackPerformances

  return { tracks, performanceId, trackPerformances }
}

export const createMockWsClient = (
  performanceId: Types.ObjectId,
  choirId: number,
  isAdmin = false,
  ttsLang = { iso: 'en-US', lang: 'English' }
) => {
  const mockClient = {
    id: generateMockId(),
    readyState: 1,
    performanceId,
    choirId,
    isAdmin,
    ttsLang,
    send: vi.fn(),
    // Mirrors SadissWebSocket.safeSend, so a test can read everything the server
    // sent off `send` however the sender reached it.
    safeSend(data: string) {
      if (this.readyState === 1) this.send(data, () => {})
    }
  }
  testWss.clients.add(mockClient as any)
  return mockClient
}
