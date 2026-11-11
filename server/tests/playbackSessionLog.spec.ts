import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { Frame } from '../types'
import { Keeps, logTo, NeverDrains } from './logStreams'

describe('a playback session writing to a log that never drains', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100 * 1000)
  })

  it('still sends every chunk, and the records it could not write are counted', () => {
    const received: any[] = []
    const phone = {
      id: 'phone',
      choirId: 0,
      ttsLang: { iso: 'en-US', lang: 'English' },
      send: (data: string) => received.push(JSON.parse(data))
    }
    const frames: Frame[] = [0, 1, 2].map((index) => ({
      partials: [{ index: 0, startTime: index, endTime: index + 1, breakpoints: [{ time: index, freq: 440, amp: 0.5 }] }],
      ttsInstructions: {}
    }))
    const stream = new NeverDrains()
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, {
      mode: 'choir',
      waveform: 'sine',
      ttsRate: 1
    })

    expect(session.start(100, () => [phone], logTo(stream))).toBe(true)
    vi.advanceTimersByTime(5000)

    expect(received.filter((message) => message.chunk)).toHaveLength(frames.length)
    expect(received.at(-1)).toEqual({ stop: true })
    expect(session.isRunning()).toBe(false)

    stream.emit('drain')
    // Every line after the start was lost: a chunk record for each of the three chunks, and the end.
    expect(stream.records().map(({ type, count }) => ({ type, count }))).toEqual([
      { type: 'start', count: undefined },
      { type: 'dropped', count: 4 }
    ])
  })
})

/** A run's records about the run itself; chunk records have tests of their own (chunkRecords.spec.ts). */
const withoutChunks = <R extends { type: string }>(records: R[]) => records.filter((record) => record.type !== 'chunk')

describe('what a playback session records', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100 * 1000)
  })

  const frames: Frame[] = [0, 1].map((index) => ({
    partials: [{ index: 0, startTime: index, endTime: index + 1, breakpoints: [{ time: index, freq: 440, amp: 0.5 }] }],
    ttsInstructions: {}
  }))

  const play = (loop: boolean, startAtChunk = 0) => {
    const stream = new Keeps()
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, startAtChunk, loop, {
      mode: 'choir',
      waveform: 'sine',
      ttsRate: 1
    })
    session.start(100, () => [], logTo(stream))
    return { session, records: () => withoutChunks(stream.lines.map((line) => JSON.parse(line))) }
  }

  it('a start, and that the track ran out once it has', () => {
    const { session, records } = play(false, 1)

    vi.advanceTimersByTime(5000)
    session.stop()

    expect(records()).toEqual([
      { t: 100000, type: 'start', trackId: 'track', loop: false, startAtChunk: 1 },
      { t: expect.any(Number), type: 'ended', trackId: 'track' }
    ])
  })

  it('that an admin stopped it, and nothing about it running out', () => {
    const { session, records } = play(false)

    vi.advanceTimersByTime(1000)
    session.stop()
    vi.advanceTimersByTime(5000)

    expect(records().map((record) => record.type)).toEqual(['start', 'stop'])
  })

  it('each time a looping track begins again', () => {
    const { session, records } = play(true)

    vi.advanceTimersByTime(5500)
    session.stop()
    vi.advanceTimersByTime(1000)

    expect(records().map((record) => record.type)).toEqual(['start', 'loop', 'loop', 'stop'])
  })

  it('each time a looping track began again, also when sending fell behind by several rounds at once', () => {
    const { session, records } = play(true)

    vi.advanceTimersByTime(1500)
    // A blocked event loop: the clock moves on by three rounds of the track, and no timer runs in between.
    vi.setSystemTime(Date.now() + 6000)
    vi.advanceTimersByTime(1000)
    session.stop()

    // The track starts at 100 s and lasts 2 s; the step after the stall runs 7.5 s in, so it began again at 2, 4 and 6 s.
    expect(records().map((record) => record.type)).toEqual(['start', 'loop', 'loop', 'loop', 'stop'])
  })

  it('a stop only once the devices have been told, as it does a start and an end', () => {
    const timeline: string[] = []
    const phone = {
      id: 'phone',
      choirId: 0,
      ttsLang: { iso: 'en-US', lang: 'English' },
      send: (data: string) => {
        const message = JSON.parse(data)
        if (message.start || message.stop) timeline.push(`told ${data}`)
      }
    }
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, false, {
      mode: 'choir',
      waveform: 'sine',
      ttsRate: 1
    })
    session.start(100, () => [phone], {
      write: (record) => {
        if (record.type !== 'chunk') timeline.push(`recorded ${record.type}`)
      }
    })

    vi.advanceTimersByTime(1000)
    session.stop()
    session.stop()
    expect(timeline).toEqual(['told {"start":true}', 'recorded start', 'told {"stop":true}', 'recorded stop'])

    vi.advanceTimersByTime(5000)
    expect(timeline).toEqual(['told {"start":true}', 'recorded start', 'told {"stop":true}', 'recorded stop'])
  })

  it('a stop before the start of a run begun straight after it', () => {
    const received: any[] = []
    const phone = {
      id: 'phone',
      choirId: 0,
      ttsLang: { iso: 'en-US', lang: 'English' },
      send: (data: string) => received.push(JSON.parse(data))
    }
    const stream = new Keeps()
    const log = logTo(stream)
    const session = (trackId: string) =>
      new PlaybackSession('650000000000000000000001', trackId, frames, 0, true, {
        mode: 'choir',
        waveform: 'sine',
        ttsRate: 1
      })

    const first = session('first')
    first.start(100, () => [phone], log)
    vi.advanceTimersByTime(1500)
    first.stop()
    const chunksOfFirst = received.filter((message) => message.chunk).length

    const second = session('second')
    second.start(100, () => [phone], log)
    vi.advanceTimersByTime(600)

    expect(withoutChunks(stream.records()).map(({ type, trackId }) => `${type} ${trackId}`)).toEqual([
      'start first',
      'stop first',
      'start second'
    ])
    expect(received.filter((message) => message.chunk)).toHaveLength(chunksOfFirst)
    expect(received.filter((message) => message.stop)).toHaveLength(1)
    expect(second.isRunning()).toBe(true)
    second.stop()
  })
})
