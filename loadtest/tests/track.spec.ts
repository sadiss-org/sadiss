import { describe, expect, it } from 'vitest'
import { partialFile, phrases, phraseText, TrackShape, ttsFiles } from '../src/track'

const NON_CHOIR: TrackShape = { seconds: 2, partialsPerFrame: 3, choir: false, tts: null }

describe('a generated partials file', () => {
  const lines = partialFile(NON_CHOIR).trim().split('\n')
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

describe('the phrases of a generated track', () => {
  const CHOIR: TrackShape = { seconds: 9, partialsPerFrame: 2, choir: true, tts: { langs: ['en-US', 'de-DE'], everySeconds: 4 } }

  it('gives every voice of a choir track a phrase every few seconds, half a second into its chunk', () => {
    expect(phrases(CHOIR)).toEqual([
      { voice: 0, time: 0.5 },
      { voice: 0, time: 4.5 },
      { voice: 0, time: 8.5 },
      { voice: 1, time: 0.5 },
      { voice: 1, time: 4.5 },
      { voice: 1, time: 8.5 }
    ])
  })

  it('gives phrases only to voice 0 outside choir mode, the voice the server reads to every phone', () => {
    const track: TrackShape = { ...CHOIR, choir: false, partialsPerFrame: 16 }
    expect(new Set(phrases(track).map((phrase) => phrase.voice))).toEqual(new Set([0]))
  })

  it('has none without TTS', () => {
    expect(phrases(NON_CHOIR)).toEqual([])
  })

  it('names the voice, the language and the time in each phrase, so a phone can tell it was sent the wrong one', () => {
    expect(phraseText(1, 'de-DE', 4.5)).toBe('voice 1 de-DE at 4.5')
  })

  it('has one SRT file per voice and language, named the way the upload reads voice and language from it', () => {
    expect(ttsFiles(CHOIR).map((file) => file.name).sort()).toEqual([
      'ttsfile_0_de-DE_loadtest',
      'ttsfile_0_en-US_loadtest',
      'ttsfile_1_de-DE_loadtest',
      'ttsfile_1_en-US_loadtest'
    ])
  })

  it('writes every phrase of its voice in its language as one SRT entry', () => {
    const file = ttsFiles(CHOIR).find((candidate) => candidate.name === 'ttsfile_1_de-DE_loadtest')
    expect(file?.content).toBe(
      [
        '1\n00:00:00,500 --> 00:00:00,900\nvoice 1 de-DE at 0.5\n',
        '2\n00:00:04,500 --> 00:00:04,900\nvoice 1 de-DE at 4.5\n',
        '3\n00:00:08,500 --> 00:00:08,900\nvoice 1 de-DE at 8.5\n'
      ].join('\n')
    )
  })

  it('writes hours and minutes into an SRT time', () => {
    const long: TrackShape = { seconds: 3700, partialsPerFrame: 1, choir: false, tts: { langs: ['en-US'], everySeconds: 3661 } }
    expect(ttsFiles(long)[0]?.content).toContain('01:01:01,500 --> 01:01:01,900')
  })
})
