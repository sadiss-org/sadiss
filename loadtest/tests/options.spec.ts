import { describe, expect, it } from 'vitest'
import { parseOptions } from '../src/options'
import { MIN_PHONES } from '../src/stats'

describe('the command line', () => {
  it('has defaults for everything', () => {
    expect(parseOptions([])).toEqual({
      apiUrl: 'http://127.0.0.1:3000',
      wsUrl: 'ws://127.0.0.1:8080',
      phones: 10,
      track: { seconds: 30, partialsPerFrame: 16, choir: false, tts: null },
      joinOverMs: 5000,
      lateShare: 0.1,
      settleMs: 60000,
      serverCommit: undefined,
      note: null
    })
  })

  it('keeps a note and a server commit given on the command line', () => {
    expect(parseOptions(['--note', 'live instance idle', '--server-commit', 'f00d'])).toMatchObject({ note: 'live instance idle', serverCommit: 'f00d' })
  })

  it('makes a choir track with one partial per voice', () => {
    expect(parseOptions(['--voices', '8']).track).toEqual({ seconds: 30, partialsPerFrame: 8, choir: true, tts: null })
  })

  it('refuses voices and partials together, since in choir mode every partial is a voice', () => {
    expect(() => parseOptions(['--voices', '8', '--partials', '16'])).toThrow('--voices')
  })

  it('gives the track phrases in the given languages, by default one every 4 s', () => {
    expect(parseOptions(['--langs', 'en-US,de-DE']).track.tts).toEqual({ langs: ['en-US', 'de-DE'], everySeconds: 4 })
    expect(parseOptions(['--langs', 'en-US', '--phrase-every', '2.5']).track.tts).toEqual({ langs: ['en-US'], everySeconds: 2.5 })
  })

  it('refuses a phrase interval without languages, which would make a track without phrases', () => {
    expect(() => parseOptions(['--phrase-every', '2'])).toThrow('--langs')
  })

  it.each(['', 'en-US,,de-DE', 'en_US'])('refuses the languages "%s"', (langs) => {
    expect(() => parseOptions(['--langs', langs])).toThrow('--langs')
  })

  it('refuses a late share that leaves fewer phones before the track than the offset from the median needs', () => {
    expect(parseOptions(['--phones', '10', '--late-share', '0.8']).lateShare).toBe(0.8)
    expect(() => parseOptions(['--phones', '10', '--late-share', '0.9'])).toThrow('--late-share')
  })

  it('reads every option', () => {
    const options = parseOptions(['--phones', '100', '--seconds', '45', '--partials', '4', '--join-over', '20', '--late-share', '0', '--settle', '0'])
    expect(options).toMatchObject({ phones: 100, track: { seconds: 45, partialsPerFrame: 4 }, joinOverMs: 20000, lateShare: 0, settleMs: 0 })
  })

  it('accepts as few phones as the offset from the median needs, and refuses one fewer', () => {
    expect(parseOptions(['--phones', String(MIN_PHONES)]).phones).toBe(MIN_PHONES)
    expect(() => parseOptions(['--phones', String(MIN_PHONES - 1)])).toThrow(`at least ${MIN_PHONES}`)
  })

  it.each([
    ['--phones', 'abc'],
    ['--phones', '0'],
    ['--phones', '1'],
    ['--phones', '2.5'],
    ['--seconds', 'abc'],
    ['--seconds', '0'],
    ['--seconds', '2.5'],
    ['--partials', '0'],
    ['--join-over', '-1'],
    ['--settle', 'x'],
    ['--settle', ''],
    ['--join-over', ' '],
    ['--voices', '0'],
    ['--phrase-every', '0'],
    ['--late-share', '1'],
    ['--late-share', '-0.1']
  ])('refuses %s %s instead of running a test that cannot fail', (option, value) => {
    expect(() => parseOptions([option, value])).toThrow(option)
  })
})
