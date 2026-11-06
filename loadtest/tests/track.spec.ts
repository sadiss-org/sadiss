import { describe, expect, it } from 'vitest'
import { partialFile } from '../src/track'

describe('a generated partials file', () => {
  const lines = partialFile({ seconds: 2, partialsPerFrame: 3 }).trim().split('\n')
  const frames = lines.slice(lines.indexOf('frame-data') + 1)
  const fields = (frame: number) => (frames[frame] ?? '').split(' ')

  it('has the header the server reads', () => {
    expect(lines.slice(0, 5)).toEqual([
      'par-text-frame-format',
      'point-type index frequency amplitude',
      'partials-count 3',
      'frame-count 200',
      'frame-data'
    ])
  })

  it('has one frame every 10 ms, each with every partial', () => {
    expect(frames).toHaveLength(200)
    expect(fields(0).slice(0, 2)).toEqual(['0.000000', '3'])
    expect(fields(1)[0]).toBe('0.010000')
    expect(fields(0)).toHaveLength(2 + 3 * 3)
  })

  it('gives each partial its own index and an audible amplitude', () => {
    const [, , ...triples] = fields(0)
    expect([triples[0], triples[3], triples[6]]).toEqual(['0', '1', '2'])
    expect(Number(triples[2])).toBeGreaterThan(0)
  })
})
