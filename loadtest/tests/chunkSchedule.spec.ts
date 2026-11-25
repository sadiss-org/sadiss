import { describe, expect, it } from 'vitest'
import { chunkSentAtMs, firstChunkSentAfter, trackWindow } from '../src/chunkSchedule'

describe('when the server sends a track’s chunks', () => {
  it('sends the first a chunk after the start and each next one a chunk later', () => {
    expect([0, 1, 29].map(chunkSentAtMs)).toEqual([1000, 2000, 30_000])
  })

  it('names the first chunk it sends after a moment of the track', () => {
    expect(firstChunkSentAfter(-500)).toBe(0)
    expect(firstChunkSentAfter(0)).toBe(0)
    expect(firstChunkSentAfter(999)).toBe(0)
    expect(firstChunkSentAfter(1000)).toBe(1)
    expect(firstChunkSentAfter(2500)).toBe(2)
  })
})

describe('the window a track’s traffic is measured in', () => {
  it('lasts the track and holds every chunk once, each half a chunk from its edges or more', () => {
    const chunkCount = 30
    const { fromMs, toMs } = trackWindow(chunkCount)
    expect(toMs - fromMs).toBe(chunkCount * 1000)
    const sent = Array.from({ length: chunkCount }, (_, chunk) => chunkSentAtMs(chunk))
    expect(sent.every((ms) => ms - fromMs >= 500 && toMs - ms >= 500)).toBe(true)
    expect(chunkSentAtMs(-1)).toBeLessThan(fromMs)
    expect(chunkSentAtMs(chunkCount)).toBeGreaterThan(toMs)
  })
})
