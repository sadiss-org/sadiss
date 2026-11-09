import { Writable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecordLog } from '../lib/recordLog'
import { PerformanceRecord } from '../lib/performanceLog'
import { PlaybackSession } from '../playbackSession'
import { Frame } from '../types'
import { logger } from '../tools'

/** A performance log writing to the one stream it is given. */
const logTo = (stream: Writable, now: () => number = Date.now) =>
  createRecordLog<PerformanceRecord>('test.jsonl', () => stream, now)

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

/** A stream that takes everything at once, and never says whether it reached the disk. */
class Keeps extends Writable {
  readonly lines: string[] = []

  write(chunk: string) {
    this.lines.push(chunk)
    return true
  }

  records() {
    return this.lines.map((line) => JSON.parse(line))
  }
}

/** A stream whose disk fails: it reports the line it could not write, then fails. */
const failsOnWrite = () =>
  new Writable({
    write: (_chunk, _encoding, callback) => callback(new Error('EIO: i/o error, write'))
  })

describe('a record log', () => {
  it('writes each record as one line of JSON, stamped with the time it was written', () => {
    const stream = new Keeps()
    let clock = 1000
    const log = logTo(stream, () => clock)

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
    const log = logTo(stream, () => 1)

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
    const log = logTo(stream, () => 1)

    log.close()
    log.write({ type: 'ended', trackId: 'track' })

    expect(stream.lines).toEqual([])
  })

  it('says how many lines it lost before it is closed', () => {
    const stream = new NeverDrains()
    const log = logTo(stream, () => 1)

    log.write({ type: 'start', trackId: 'track', loop: false, startAtChunk: 0 })
    log.write({ type: 'loop', trackId: 'track' })
    log.close()

    expect(stream.records().map(({ type, count }) => ({ type, count }))).toEqual([
      { type: 'start', count: undefined },
      { type: 'dropped', count: 1 }
    ])
  })

  it('counts every line a failed stream did not confirm, and the ones dropped while it was backed up, and says how many in the next stream a minute later', () => {
    const failing = new NeverDrains()
    const next = new Keeps()
    const opened: boolean[] = []
    const streams = [failing, next]
    const log = createRecordLog<PerformanceRecord>(
      'test.jsonl',
      (afterFailure) => {
        opened.push(afterFailure)
        return streams[opened.length - 1]
      },
      () => 1
    )

    // Taken by the stream but never confirmed.
    log.write({ type: 'start', trackId: 'track', loop: false, startAtChunk: 0 })
    // Dropped while it is backed up.
    log.write({ type: 'loop', trackId: 'track' })
    log.write({ type: 'loop', trackId: 'track' })
    failing.emit('error', new Error('ENOSPC: no space left on device, write'))
    // Arrives before the next try is due.
    log.write({ type: 'ended', trackId: 'track' })

    expect(opened).toEqual([false])
    expect(log.unsettled).toBe(4)

    vi.advanceTimersByTime(60 * 1000)
    log.write({ type: 'start', trackId: 'again', loop: false, startAtChunk: 0 })

    expect(opened).toEqual([false, true])
    expect(next.records()).toEqual([
      { t: 1, type: 'dropped', count: 4 },
      { t: 1, type: 'start', trackId: 'again', loop: false, startAtChunk: 0 }
    ])
  })

  it('counts a line the stream reports it could not write once, though the stream then fails as well', async () => {
    const failing = failsOnWrite()
    const next = new Keeps()
    const streams: Writable[] = [failing, next]
    const log = createRecordLog<PerformanceRecord>(
      'test.jsonl',
      () => streams.shift() ?? next,
      () => 1
    )
    const failed = new Promise((resolve) => failing.once('error', resolve))

    log.write({ type: 'loop', trackId: 'track' })
    log.write({ type: 'loop', trackId: 'track' })
    await failed
    vi.advanceTimersByTime(60 * 1000)

    expect(next.records()).toEqual([{ t: 1, type: 'dropped', count: 2 }])
  })

  it('counts what arrives while its stream cannot be opened, and tries again a minute later', () => {
    const next = new Keeps()
    let tries = 0
    const log = createRecordLog<PerformanceRecord>(
      'test.jsonl',
      () => {
        if (!tries++) throw new Error('EACCES: permission denied')
        return next
      },
      () => 1
    )

    log.write({ type: 'loop', trackId: 'track' })
    vi.advanceTimersByTime(59 * 1000)
    log.write({ type: 'loop', trackId: 'track' })
    expect(tries).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(next.records()).toEqual([{ t: 1, type: 'dropped', count: 2 }])
  })

  it('says on the console why its stream failed', () => {
    const errors = vi.spyOn(logger, 'error')
    const stream = new Keeps()
    const log = logTo(stream)

    log.write({ type: 'loop', trackId: 'track' })
    stream.emit('error', new Error('ENOSPC: no space left on device, write'))

    expect(errors).toHaveBeenCalledWith(expect.stringContaining('ENOSPC: no space left on device'))
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

    expect(session.start(100, () => [phone], logTo(stream))).toBe(true)
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
    session.start(100, () => [], logTo(stream))
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
    vi.advanceTimersByTime(1000)

    expect(records().map((record) => record.type)).toEqual(['start', 'loop', 'loop', 'stop'])
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
    session.start(100, () => [phone], { write: (record) => timeline.push(`recorded ${record.type}`) })

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

    expect(stream.records().map(({ type, trackId }) => `${type} ${trackId}`)).toEqual([
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
