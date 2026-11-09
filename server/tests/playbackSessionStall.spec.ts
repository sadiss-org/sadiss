import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { noPerformanceLog } from '../lib/performanceLog'
import { Recipient } from '../lib/audience'
import { Frame, PartialChunk, TrackSettings } from '../types'
import { logger } from '../tools'

/**
 * What a playback session does when the server falls behind its schedule, for
 * example because the event loop was blocked.
 *
 * A stall is made by moving the system clock without running any timer, which
 * is what a blocked event loop looks like to the session: its next timer fires,
 * but later than planned.
 *
 * Chunk n is dated so that it sounds from LEAD_SECONDS (2 s) after the session's
 * start time plus n seconds, for one second. It is sent about one second before
 * it sounds.
 */

const PERFORMANCE_ID = '650000000000000000000001'
const CHUNK_MS = 1000

const settings: TrackSettings = { mode: 'nonChoir', waveform: 'sine', ttsRate: 1 }

const partial = (index: number): PartialChunk => ({
  index,
  startTime: index,
  endTime: index + 1,
  breakpoints: [{ time: index, freq: 100 + index, amp: 0.5 }]
})

/** A track whose frame n holds partial n, so a chunk shows which frame it was. */
const track = (length: number): Frame[] => Array.from({ length }, (_, n) => ({ partials: [partial(n)], ttsInstructions: {} }))

const device = () => {
  const received: { message: any; at: number }[] = []
  const recipient: Recipient = {
    id: 'device',
    choirId: -1,
    ttsLang: { iso: 'en-US', lang: 'English' },
    send: (data: string) => received.push({ message: JSON.parse(data), at: Date.now() })
  }
  const chunks = () => received.filter(({ message }) => message.chunk)
  return {
    recipient,
    /** The frames this device was sent, in order. */
    frames: () => chunks().map(({ message }) => message.chunk.partials[0].index),
    /** Chunks that arrived after their second had finished sounding. */
    arrivedTooLate: () =>
      chunks().filter(({ message, at }) => at >= (message.startTime + message.chunk.partials[0].index + 1) * 1000),
    stopped: () => received.some(({ message }) => message.stop)
  }
}

/** True when each frame follows the one before it. */
const consecutive = (frames: number[]) => frames.every((frame, i) => i === 0 || frame === frames[i - 1] + 1)

const playChunks = (count: number) => vi.advanceTimersByTime(count * CHUNK_MS)

/**
 * Makes the session's next timer fire `ms` late, as a blocked event loop does:
 * the clock moves on and no timer runs in between.
 */
const stall = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe('a playback session that falls behind', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const startPlaying = (frames: Frame[], loop = false, startAtChunk = 0) => {
    const phone = device()
    const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, startAtChunk, loop, settings)
    session.start(Date.now() / 1000, () => [phone.recipient], noPerformanceLog)
    return { phone, session }
  }

  it('keeps playing after a stall of 1.5 s, and still sends the chunk that can sound', () => {
    const { phone, session } = startPlaying(track(10))
    playChunks(3)

    stall(1500)
    playChunks(3)

    expect(phone.stopped()).toBe(false)
    expect(session.isRunning()).toBe(true)
    expect(phone.frames().slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(consecutive(phone.frames())).toBe(true)
    expect(phone.arrivedTooLate()).toEqual([])
  })

  it('skips the chunks that are already over, and sends every later one while it can still sound', () => {
    const warn = vi.spyOn(logger, 'warn')
    const { phone, session } = startPlaying(track(10))
    playChunks(3)

    // Chunk 3 would sound from 5 s to 6 s and chunk 4 from 6 s to 7 s; the
    // session wakes at 7.5 s.
    stall(3500)
    playChunks(3)

    expect(session.isRunning()).toBe(true)
    expect(phone.frames().slice(0, 4)).toEqual([0, 1, 2, 5])
    expect(consecutive(phone.frames().slice(3))).toBe(true)
    expect(phone.arrivedTooLate()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/3500 ms behind.*skipped 2 chunks/))
  })

  it('lands on the right chunk of the next round when a looping track stalls across its end', () => {
    const { phone } = startPlaying(track(4), true)
    playChunks(3)

    stall(3500)
    playChunks(2)

    expect(phone.frames().slice(0, 5)).toEqual([0, 1, 2, 1, 2])
  })

  it('still stops at the end of a track that does not loop', () => {
    const { phone, session } = startPlaying(track(3))
    playChunks(5)

    expect(phone.frames()).toEqual([0, 1, 2])
    expect(phone.stopped()).toBe(true)
    expect(session.isRunning()).toBe(false)
  })

  it('skips by track position when the track starts part way in', () => {
    const { phone } = startPlaying(track(12), false, 3)
    playChunks(3)

    stall(3500)
    playChunks(1)

    expect(phone.frames().slice(0, 4)).toEqual([3, 4, 5, 8])
  })

  it('skips by the round it is in once a looping track has gone round', () => {
    const { phone } = startPlaying(track(4), true)
    playChunks(5)

    stall(3500)
    playChunks(1)

    expect(phone.frames().slice(0, 6)).toEqual([0, 1, 2, 3, 0, 3])
  })

  it('goes on at the chunk now due when a looping track stalls for longer than the whole track', () => {
    const { phone, session } = startPlaying(track(4), true)
    playChunks(3)

    // Chunk n of the whole run sounds from n + 2 s to n + 3 s. The session wakes
    // at 13.5 s, when run chunk 11 is sounding: the third round's chunk 3.
    stall(9500)
    playChunks(1)

    expect(phone.frames().slice(0, 4)).toEqual([0, 1, 2, 3])
    expect(session.progress()).toMatchObject({ chunkIndex: expect.any(Number), totalChunks: 4 })
    const { chunkIndex } = session.progress() as { chunkIndex: number }
    expect(chunkIndex).toBeLessThan(4)
  })

  it('keeps a chunk whose sound lies later than its place in the track', () => {
    // A partials file with a gap: frame 3 holds sound from 8 s to 9 s.
    const frames = track(10)
    frames[3] = { partials: [{ ...partial(3), startTime: 8, endTime: 9 }], ttsInstructions: {} }
    const { phone } = startPlaying(frames)
    playChunks(3)

    // Frame 3 sounds from 10 s to 11 s; the session wakes at 7.5 s.
    stall(3500)
    playChunks(1)

    expect(phone.frames().slice(0, 4)).toEqual([0, 1, 2, 3])
  })
})
