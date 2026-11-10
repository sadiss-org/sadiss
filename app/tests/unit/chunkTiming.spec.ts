import { ChunkEnvelope } from '@/types/types'
import { chunkLeadMs, chunkTiming } from '@/composables/chunkTiming'

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

describe('how long before its sound a chunk arrived', () => {
  it('is the time left until the sound by the server clock, the phone being offsetMs behind it', () => {
    expect(chunkLeadMs(10_000, 1_000, 8_000)).toBe(1_000)
  })

  it('is negative for a chunk that arrived after its sound', () => {
    expect(chunkLeadMs(10_000, 3_000, 8_000)).toBe(-1_000)
  })

  it('is unknown while the phone has no estimate of the server clock', () => {
    expect(chunkLeadMs(10_000, 1_000, null)).toBeNull()
  })
})
