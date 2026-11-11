import { Writable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { createRecordLog } from '../lib/recordLog'
import { PerformanceRecord } from '../lib/logRecords'
import { logger } from '../tools'
import { failsOnWrite, Keeps, logTo, NeverDrains } from './logStreams'

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

  it('counts every line a failed stream did not confirm, and the ones dropped while it was backed up, and says how many in the next stream a minute later', async () => {
    const failing = new NeverDrains()
    const next = new Keeps()
    const steps: string[] = []
    const streams = [failing, next]
    const log = createRecordLog<PerformanceRecord>(
      'test.jsonl',
      () => {
        steps.push('open')
        return streams[steps.filter((step) => step === 'open').length - 1]
      },
      () => 1,
      async () => {
        steps.push('prepare')
      }
    )

    // Taken by the stream but never confirmed.
    log.write({ type: 'start', trackId: 'track', loop: false, startAtChunk: 0 })
    // Dropped while it is backed up.
    log.write({ type: 'loop', trackId: 'track' })
    log.write({ type: 'loop', trackId: 'track' })
    failing.emit('error', new Error('ENOSPC: no space left on device, write'))
    // Arrives before the next try is due.
    log.write({ type: 'ended', trackId: 'track' })

    expect(steps).toEqual(['open'])
    expect(log.unsettled).toBe(4)

    await vi.advanceTimersByTimeAsync(60 * 1000)
    log.write({ type: 'start', trackId: 'again', loop: false, startAtChunk: 0 })

    expect(steps).toEqual(['open', 'prepare', 'open'])
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
    await vi.advanceTimersByTimeAsync(60 * 1000)

    expect(next.records()).toEqual([{ t: 1, type: 'dropped', count: 2 }])
  })

  it('counts what arrives while its stream cannot be opened, and tries again a minute later', async () => {
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

    await vi.advanceTimersByTimeAsync(1000)
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
