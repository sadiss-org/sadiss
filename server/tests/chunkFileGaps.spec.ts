import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { readAndParseChunkFile } from '../services/fileService'

/**
 * A track's chunk file has a gap wherever a second holds neither a tone nor a
 * phrase, as between the phrases of a TTS track, and a gap is stored as null.
 * Playback has to treat it as a second with nothing in it, including when the
 * server falls behind and skips the chunks that are already over.
 */

const fixtures = path.join(__dirname, 'testFiles')
const ttsTrack = { chunkFileName: 'testChunkFile_ttsOneVoiceTwoLanguages.json' }

describe('a chunk file with gaps', () => {
  let chunksDir: string | undefined

  beforeEach(() => {
    chunksDir = process.env.CHUNKS_DIR
    process.env.CHUNKS_DIR = fixtures
    vi.useFakeTimers()
  })

  afterEach(() => {
    process.env.CHUNKS_DIR = chunksDir
    vi.restoreAllMocks()
  })

  it('is read as one frame per second, a gap being a frame with nothing in it', async () => {
    const frames = await readAndParseChunkFile(ttsTrack)

    expect(frames?.length).toBe(37)
    expect(frames?.every((frame) => Array.isArray(frame.partials))).toBe(true)
  })

  it('keeps playing when sending falls behind across its gaps', async () => {
    const frames = (await readAndParseChunkFile(ttsTrack)) ?? []
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, {
      mode: 'nonChoir',
      waveform: 'sine',
      ttsRate: 1
    })
    session.start(Date.now() / 1000, () => [])

    vi.advanceTimersByTime(3000)
    // A blocked event loop: the clock moves on and no timer runs in between.
    vi.setSystemTime(Date.now() + 5000)
    vi.advanceTimersByTime(3000)

    expect(session.isRunning()).toBe(true)
    session.stop()
  })
})
