import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { payloadsForChunk } from '../chunkPayloads'
import { Recipient } from '../lib/audience'
import { Frame, PartialChunk, TrackSettings } from '../types'
import { Keeps, logTo } from './logStreams'

/** What the performance log records about each chunk a session sends. */

const partial = (index: number, second: number): PartialChunk => ({
  index,
  startTime: second,
  endTime: second + 1,
  breakpoints: [{ time: second, freq: 440, amp: 0.5 }]
})

const phone = (id: string, choirId: number): Recipient => ({
  id,
  choirId,
  ttsLang: { iso: 'en-US', lang: 'English' },
  send: () => undefined
})

const choir: TrackSettings = { mode: 'choir', waveform: 'sine', ttsRate: 1 }
const nonChoir: TrackSettings = { mode: 'nonChoir', waveform: 'sine', ttsRate: 1 }

describe('the chunk record a session writes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100 * 1000)
  })

  it('is written once for each chunk, saying how late it went out, how long sending took and to how many devices', () => {
    const frames: Frame[] = [0, 1, 2].map((second) => ({
      partials: [partial(0, second), partial(1, second)],
      ttsInstructions: {}
    }))
    const stream = new Keeps()
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, choir)

    session.start(100, () => [phone('a', 0)], logTo(stream))
    vi.advanceTimersByTime(5000)

    const chunks = stream.records().filter((record) => record.type === 'chunk')
    expect(chunks.map((record) => record.index)).toEqual([0, 1, 2])
    for (const record of chunks) {
      expect(record).toEqual({
        t: expect.any(Number),
        type: 'chunk',
        index: expect.any(Number),
        lateMs: expect.any(Number),
        sendMs: expect.any(Number),
        devices: 1,
        // The partial for voice 1 has no device singing it.
        unassignedPartials: 1
      })
    }
  })

  it('is written for a chunk with nobody to send it to, with every partial left over', () => {
    const frames: Frame[] = [{ partials: [partial(0, 0), partial(1, 0)], ttsInstructions: {} }]
    const stream = new Keeps()
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, choir)

    session.start(100, () => [], logTo(stream))
    vi.advanceTimersByTime(3000)

    expect(stream.records().filter((record) => record.type === 'chunk')).toEqual([
      { t: expect.any(Number), type: 'chunk', index: 0, lateMs: expect.any(Number), sendMs: 0, devices: 0, unassignedPartials: 2 }
    ])
  })
})

describe('the partials a chunk leaves without a device', () => {
  it('in choir mode, are those whose voice no device sings', () => {
    const frame: Frame = { partials: [partial(0, 0), partial(1, 0), partial(2, 0)], ttsInstructions: {} }
    expect(payloadsForChunk(frame, [phone('a', 0), phone('b', 2)], 100, choir, {}).unassignedPartials).toBe(1)
  })

  it('in nonChoir mode, are those over what the devices can take', () => {
    const frame: Frame = { partials: Array.from({ length: 20 }, (_, index) => partial(index, 0)), ttsInstructions: {} }
    // One device takes at most 16.
    expect(payloadsForChunk(frame, [phone('a', 0)], 100, nonChoir, {}).unassignedPartials).toBe(4)
  })

  it('in nonChoir mode, are none while the devices can take them all', () => {
    const frame: Frame = { partials: Array.from({ length: 20 }, (_, index) => partial(index, 0)), ttsInstructions: {} }
    expect(payloadsForChunk(frame, [phone('a', 0), phone('b', 1)], 100, nonChoir, {}).unassignedPartials).toBe(0)
  })
})
