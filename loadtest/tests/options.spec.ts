import { describe, expect, it } from 'vitest'
import { parseOptions } from '../src/options'
import { MIN_PHONES } from '../src/stats'

describe('the command line', () => {
  it('has defaults for everything', () => {
    expect(parseOptions([])).toEqual({
      apiUrl: 'http://127.0.0.1:3000',
      wsUrl: 'ws://127.0.0.1:8080',
      phones: 10,
      track: { seconds: 30, partialsPerFrame: 16 },
      joinOverMs: 5000,
      settleMs: 60000
    })
  })

  it('reads every option', () => {
    const options = parseOptions(['--phones', '100', '--seconds', '45', '--partials', '4', '--join-over', '20', '--settle', '0'])
    expect(options).toMatchObject({ phones: 100, track: { seconds: 45, partialsPerFrame: 4 }, joinOverMs: 20000, settleMs: 0 })
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
    ['--join-over', ' ']
  ])('refuses %s %s instead of running a test that cannot fail', (option, value) => {
    expect(() => parseOptions([option, value])).toThrow(option)
  })
})
