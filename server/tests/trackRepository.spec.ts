import { trackRepository } from '../repositories/TrackRepository'
import { Track } from '../models/track'
import { generateMockId } from './testUtils'
import { describe, it, expect } from 'vitest'

describe('trackRepository', () => {
  it('reads a TTS rate stored as a string as a number', async () => {
    const { insertedId } = await Track.collection.insertOne({
      name: 'stored before the rate was a number',
      mode: 'choir',
      isPublic: true,
      creator: generateMockId(),
      ttsRate: '0.8'
    })

    const track = await trackRepository.findById(insertedId)

    expect(track?.ttsRate).toBe(0.8)
  })
})
