import { Writable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPerformanceLog } from '../lib/performanceLog'
import { PlaybackSession } from '../playbackSession'
import { Frame } from '../types'

/**
 * A stream whose buffer is always full: it takes each line it is given, says it
 * cannot take more, and only drains when the test emits `drain` itself.
 */
class NeverDrains extends Writable {
  readonly lines: string[] = []

  write(chunk: string) {
    this.lines.push(chunk)
    return false
  }

  records() {
    return this.lines.map((line) => JSON.parse(line))
  }
}

/** A stream that takes everything at once. */
class Keeps extends Writable {
  readonly lines: string[] = []

  write(chunk: string) {
    this.lines.push(chunk)
    return true
  }
}

describe('a performance log', () => {
  it('writes each record as one line of JSON, stamped with the time it was written', () => {
    const stream = new Keeps()
    let clock = 1000
    const log = createPerformanceLog(stream, () => clock)

    log.write({ type: 'start', trackId: 'track', loop: false, startAtChunk: 3 })
    clock = 2500
    log.write({ type: 'ended', trackId: 'track' })

    expect(stream.lines).toEqual([
      '{"t":1000,"type":"start","trackId":"track","loop":false,"startAtChunk":3}\n',
      '{"t":2500,"type":"ended","trackId":"track"}\n'
    ])
  })

  it('drops what arrives while the stream is backed up, and says how many once it drains', () => {
    const stream = new NeverDrains()
    const log = createPerformanceLog(stream, () => 1)

    log.write({ type: 'start', trackId: 'track', loop: false, startAtChunk: 0 })
    log.write({ type: 'loop', trackId: 'track' })
    log.write({ type: 'loop', trackId: 'track' })

    expect(stream.records().map((record) => record.type)).toEqual(['start'])

    stream.emit('drain')
    log.write({ type: 'stop', trackId: 'track' })

    // The count goes out once, and the stream it went into is full again, so
    // the record after it is the next one dropped.
    expect(stream.records()).toEqual([
      { t: 1, type: 'start', trackId: 'track', loop: false, startAtChunk: 0 },
      { t: 1, type: 'dropped', count: 2 }
    ])

    stream.emit('drain')
    expect(stream.records().at(-1)).toEqual({ t: 1, type: 'dropped', count: 1 })
  })

  it('writes nothing after it is closed', () => {
    const stream = new Keeps()
    const log = createPerformanceLog(stream, () => 1)

    log.close()
    log.write({ type: 'ended', trackId: 'track' })

    expect(stream.lines).toEqual([])
  })

  it('stops writing, without throwing, once its stream fails', () => {
    const stream = new Keeps()
    const log = createPerformanceLog(stream, () => 1)

    stream.emit('error', new Error('disk full'))
    log.write({ type: 'ended', trackId: 'track' })

    expect(stream.lines).toEqual([])
  })
})

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

    expect(session.start(100, () => [phone], createPerformanceLog(stream, Date.now))).toBe(true)
    vi.advanceTimersByTime(5000)

    expect(received.filter((message) => message.chunk)).toHaveLength(frames.length)
    expect(received.at(-1)).toEqual({ stop: true })
    expect(session.isRunning()).toBe(false)

    stream.emit('drain')
    expect(stream.records().map(({ type, count }) => ({ type, count }))).toEqual([
      { type: 'start', count: undefined },
      { type: 'dropped', count: 1 }
    ])
  })
})

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
    session.start(100, () => [], createPerformanceLog(stream, Date.now))
    return { session, records: () => stream.lines.map((line) => JSON.parse(line)) }
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

    expect(records().map((record) => record.type)).toEqual(['start', 'loop', 'loop', 'stop'])
  })
})
