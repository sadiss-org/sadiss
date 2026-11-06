import { describe, expect, it } from 'vitest'
import { arrivalLeadMs, chunkNumber, summarize, spread } from '../src/measure'

/** A chunk message as the server sends it in nonChoir mode. */
const chunkMessage = (startTime: number, partialStart: number) => ({
  startTime,
  waveform: 'sine',
  ttsRate: 1,
  chunk: {
    partials: [{ index: 0, startTime: partialStart, endTime: partialStart + 0.999, breakpoints: [{ time: partialStart, freq: 440, amp: 0.5 }] }]
  }
})

describe('how long before its sound a chunk arrived', () => {
  it('is the chunk sound start in server time minus the arrival in server time, by the phone estimate', () => {
    // Chunk sounds at server second 1002 + 3 = 1005. The phone receives it at
    // its own 4000 ms and estimates the server 1 000 000 ms ahead of it.
    expect(arrivalLeadMs(chunkMessage(1002, 3), 4000, 1_000_000)).toBe(1000)
  })

  it('is negative for a chunk that arrived after it should have started', () => {
    expect(arrivalLeadMs(chunkMessage(1002, 3), 5250, 1_000_000)).toBe(-250)
  })

  it('starts from the earliest sound in the chunk', () => {
    const message = chunkMessage(1002, 3)
    message.chunk.partials.push({ index: 1, startTime: 3.5, endTime: 4.499, breakpoints: [{ time: 3.5, freq: 1, amp: 1 }] })
    expect(arrivalLeadMs(message, 4000, 1_000_000)).toBe(1000)
  })
})

describe('which chunk of the track a message carries', () => {
  it('is the whole second its partials start in', () => {
    expect(chunkNumber(chunkMessage(1002, 7))).toBe(7)
  })

  it('is not thrown off by a start a hair below the second', () => {
    expect(chunkNumber(chunkMessage(1002, 6.9999999))).toBe(7)
  })
})

describe('a summary of measured values', () => {
  it('gives the median, the 95th and 99th percentile and the extremes', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(summarize(values)).toEqual({ count: 100, min: 1, median: 50.5, p95: 95.05, p99: 99.01, max: 100 })
  })

  it('is empty for no values', () => {
    expect(summarize([])).toEqual({ count: 0, min: null, median: null, p95: null, p99: null, max: null })
  })
})

describe('the spread of the phones’ clock offsets at one moment', () => {
  it('is the distance between the highest and the lowest offset', () => {
    expect(spread([1000.5, 1003, 999])).toBe(4)
  })

  it('leaves out phones that have no offset yet', () => {
    expect(spread([null, 1000, 1002])).toBe(2)
  })

  it('is null with fewer than two phones that have an offset', () => {
    expect(spread([null, 1000])).toBeNull()
  })
})
