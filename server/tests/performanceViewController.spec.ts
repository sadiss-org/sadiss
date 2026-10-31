import { SadissPerformance } from '../models'
import { generateMockId, createTestTrackPerformance } from './testUtils'
import { agent } from './setupTests'
import { describe, it, expect, vi } from 'vitest'
import { mockUser } from './setupTests'

describe('getPerformanceWithTracks', () => {
  it('should return performance data with associated tracks in correct order', async () => {
    const { performanceId, tracks, trackPerformances } = await createTestTrackPerformance(2)

    const res = await agent.get(`/api/performance/${performanceId}/with-tracks`).expect(200)

    expect(res.body).toEqual({
      performance: {
        _id: performanceId.toString(),
        name: 'test performance',
        creator: { username: 'Test User' },
        tracks: [
          {
            _id: tracks[0]._id,
            chunkFileName: tracks[0].chunkFileName,
            name: 'test track',
            partialFile: {
              fileName: tracks[0].partialFile.fileName,
              origName: tracks[0].partialFile.origName
            },
            ttsFiles: [
              {
                fileName: tracks[0].ttsFiles[0].fileName,
                lang: tracks[0].ttsFiles[0].lang,
                origName: tracks[0].ttsFiles[0].origName,
                voice: tracks[0].ttsFiles[0].voice
              }
            ],
            mode: 'choir',
            waveform: 'sine',
            ttsRate: 1,
            creator: mockUser.id.toString(),
            isPublic: true,
            notes: 'test notes',
            sortOrder: 1,
            trackPerformanceId: trackPerformances[0]._id,
            startTime: 0,
            partialsCount: 8
          },
          {
            _id: tracks[1]._id,
            chunkFileName: tracks[1].chunkFileName,
            name: 'test track',
            partialFile: {
              fileName: tracks[1].partialFile.fileName,
              origName: tracks[1].partialFile.origName
            },
            ttsFiles: [
              {
                fileName: tracks[1].ttsFiles[0].fileName,
                lang: tracks[1].ttsFiles[0].lang,
                origName: tracks[1].ttsFiles[0].origName,
                voice: tracks[1].ttsFiles[0].voice
              }
            ],
            mode: 'choir',
            waveform: 'sine',
            ttsRate: 1,
            creator: mockUser.id.toString(),
            isPublic: true,
            sortOrder: 2,
            trackPerformanceId: trackPerformances[1]._id,
            notes: 'test notes',
            startTime: 0,
            partialsCount: 8
          }
        ]
      }
    })

    // Delete one of the tracks
    await agent.post(`/api/track/delete/${tracks[0]._id}`).send()

    // Check if the track is no longer in response
    const res2 = await agent.get(`/api/performance/${performanceId}/with-tracks`).expect(200)
    expect(res2.body.performance.tracks.length).toBe(1)
  })

  it('should return error response if fetching performance fails', async () => {
    SadissPerformance.findById = vi.fn().mockImplementationOnce(() => {
      throw new Error('Server error')
    })

    const mockId = generateMockId()

    const res = await agent.get(`/api/performance/${mockId}`).expect(500)
    expect(res.body).toEqual({ Error: 'Failed fetching performance.' })
    expect(SadissPerformance.findById).toHaveBeenCalledWith(mockId.toString())
  })
})
