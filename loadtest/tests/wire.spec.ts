import { describe, expect, it } from 'vitest'
import type { ChunkEnvelope } from '@server/types/ChunkEnvelope'
import { chunkTiming } from '../src/wire'

const partial = (start: number) => ({
  index: 0,
  startTime: start,
  endTime: start + 0.999,
  breakpoints: [{ time: start, freq: 440, amp: 0.5 }]
})

const envelope = (chunk: ChunkEnvelope['chunk']): ChunkEnvelope => ({ startTime: 1002, waveform: 'sine', ttsRate: 1, chunk })

describe('when a chunk sounds and which chunk it is', () => {
  it('sounds at the track start plus its first partial, in server milliseconds', () => {
    expect(chunkTiming(envelope({ partials: [partial(3)] }))).toEqual({ chunk: 3, soundsAtServerMs: 1_005_000 })
  })

  it('starts with the earliest of its partials', () => {
    expect(chunkTiming(envelope({ partials: [partial(3.5), partial(3)] }))?.soundsAtServerMs).toBe(1_005_000)
  })

  it('is not thrown off by a start a hair below the second', () => {
    expect(chunkTiming(envelope({ partials: [partial(6.9999999)] }))?.chunk).toBe(7)
  })

  it('has no timing when the chunk carries no partials, such as one with only a phrase', () => {
    expect(chunkTiming(envelope({ partials: [], ttsInstructions: { time: 4, phrase: 'hello' } }))).toBeNull()
    expect(chunkTiming(envelope({ ttsInstructions: { time: 4, phrase: 'hello' } }))).toBeNull()
  })
})
