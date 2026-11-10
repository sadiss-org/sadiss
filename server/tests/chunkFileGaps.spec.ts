import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { readAndParseChunkFile } from '../services/fileService'
import { chunk } from '../tools/chunk'
import { convertSrtToJson } from '../tools/convertSrtToJson'
import { Recipient } from '../lib/audience'

/**
 * A track's chunk file has a gap wherever a second holds neither a tone nor a
 * phrase, as between the phrases of a TTS track, and a gap is stored as null.
 * Playback has to treat it as a second with nothing in it, including when the
 * server falls behind and skips the chunks that are already over.
 *
 * The chunk file is made the way an upload makes it, from subtitle files with
 * phrases at 3.6 s, 17 s and 36.1 s, so it has the gaps and the format that
 * files on the server have.
 */

const subtitles = path.join(__dirname, 'testFiles')
const ttsTrack = { chunkFileName: 'tts-one-voice-two-languages.json' }

/** A phone singing voice 0 in English, which keeps what it is sent. */
const englishPhone = () => {
  const received: string[] = []
  const phone: Recipient = {
    id: 'phone',
    choirId: 0,
    ttsLang: { iso: 'en-US', lang: 'English' },
    send: (data) => received.push(data)
  }
  return { phone, received }
}

describe('a chunk file with gaps', () => {
  let chunksDir: string | undefined

  beforeEach(async () => {
    chunksDir = process.env.CHUNKS_DIR
    process.env.CHUNKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sadiss-chunks-'))
    const { ttsJson } = convertSrtToJson([
      { path: path.join(subtitles, 'testSrtFile_choir_voice_0_en.srt'), originalname: 'voice_0_en-US' },
      { path: path.join(subtitles, 'testSrtFile_choir_voice_0_de.srt'), originalname: 'voice_0_de-DE' }
    ])
    const { chunks } = await chunk(undefined, ttsJson)
    fs.writeFileSync(path.join(process.env.CHUNKS_DIR, ttsTrack.chunkFileName), JSON.stringify(chunks))
    vi.useFakeTimers()
  })

  afterEach(() => {
    fs.rmSync(process.env.CHUNKS_DIR ?? '', { recursive: true, force: true })
    process.env.CHUNKS_DIR = chunksDir
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is read as one frame per second, a gap being a frame with nothing in it', async () => {
    const frames = await readAndParseChunkFile(ttsTrack)

    expect(frames?.length).toBe(37)
    expect(frames?.every((frame) => Array.isArray(frame.partials))).toBe(true)
  })

  it('keeps sending phrases when sending falls behind across its gaps', async () => {
    const frames = (await readAndParseChunkFile(ttsTrack)) ?? []
    const { phone, received } = englishPhone()
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, {
      mode: 'choir',
      waveform: 'sine',
      ttsRate: 1
    })
    session.start(Date.now() / 1000, () => [phone])

    vi.advanceTimersByTime(5000)
    // A blocked event loop: the clock moves on and no timer runs in between.
    vi.setSystemTime(Date.now() + 5000)
    vi.advanceTimersByTime(10000)

    expect(session.isRunning()).toBe(true)
    expect(received.some((data) => data.includes('This is the first line of voice zero.'))).toBe(true)
    expect(received.some((data) => data.includes('This is the second line of voice zero.'))).toBe(true)
    session.stop()
  })
})
