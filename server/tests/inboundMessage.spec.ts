import { describe, expect, it } from 'vitest'
import { readInboundMessage } from '../lib/inboundMessage'

/**
 * What the server will and will not accept off the wire.
 *
 * The cases that matter most are the ones that must keep being accepted: a build
 * already on a phone has to go on registering against a newer server, and every
 * predicate here is a chance to turn one away. `wireContract.spec.ts` proves the
 * real handshake still gets through; these tests say why each field is required.
 */

const ttsLang = { iso: 'en-US', lang: 'English' }

const read = (frame: unknown) => readInboundMessage(JSON.stringify(frame))

describe('reading a frame as one of our messages', () => {
  describe('frames that are not messages at all', () => {
    it.each([
      ['not JSON', 'nonsense{'],
      ['JSON that is not an object', '"hello"'],
      // This one crashed the process: reading .message off null threw.
      ['the literal null', 'null'],
      ['an array', '[1, 2, 3]']
    ])('discards %s', (_, raw) => {
      expect(readInboundMessage(raw)).toBeUndefined()
    })

    it('discards an object with no message type', () => {
      expect(read({ clientId: 0 })).toBeUndefined()
    })

    it('discards a message type it does not know', () => {
      expect(read({ message: 'somethingElse', clientId: 0 })).toBeUndefined()
    })

    it.each(['__proto__', 'constructor', 'valueOf', 'hasOwnProperty', 'toString'])(
      'discards a message type named after %s, which every object inherits',
      (message) => {
        expect(read({ message })).toBeUndefined()
      }
    )
  })

  describe('the handshake a device registers with', () => {
    it('accepts the handshake a build from before versioning sends', () => {
      expect(read({ message: 'clientInfo', clientId: 3, ttsLang, performanceId: 'abc' })).toEqual({
        message: 'clientInfo',
        clientId: 3,
        ttsLang,
        performanceId: 'abc',
        protocolVersion: undefined
      })
    })

    it('keeps the version when one is announced', () => {
      const parsed = read({ message: 'clientInfo', clientId: 0, ttsLang, performanceId: 'abc', protocolVersion: 2 })
      expect(parsed).toMatchObject({ protocolVersion: 2 })
    })

    // A QR code generated with no TTS languages leaves the device's language at
    // `{ iso: '', lang: '' }`, and it sends the handshake anyway. Requiring
    // anything non-empty here would stop those devices registering.
    it('accepts empty strings for the language and the performance', () => {
      const parsed = read({ message: 'clientInfo', clientId: 0, ttsLang: { iso: '', lang: '' }, performanceId: '' })
      expect(parsed).toMatchObject({ ttsLang: { iso: '', lang: '' }, performanceId: '' })
    })

    it('drops keys it was not expecting, so nothing downstream can read them', () => {
      const parsed = read({ message: 'clientInfo', clientId: 0, ttsLang, performanceId: 'abc', extra: 'ignored' })
      expect(parsed).not.toHaveProperty('extra')
    })

    it.each([
      ['a choir id that is not a number', { clientId: '3' }],
      // ttsLang reaches `langs[ttsLang.iso]` when a phrase is picked, so a bare
      // string here would silently produce an empty phrase rather than an error.
      ['a language that is a bare string', { ttsLang: 'en-US' }],
      ['a language missing its iso code', { ttsLang: { lang: 'English' } }],
      ['a performance id that is not a string', { performanceId: 42 }],
      ['a version that is not a number', { protocolVersion: '2' }]
    ])('discards a handshake with %s', (_, override) => {
      expect(read({ message: 'clientInfo', clientId: 0, ttsLang, performanceId: 'abc', ...override })).toBeUndefined()
    })
  })

  describe('a clock-sync ping', () => {
    it('accepts one carrying the send stamp', () => {
      expect(read({ message: 'measure', t0: 1234 })).toEqual({ message: 'measure', t0: 1234 })
    })

    // Without t0 the round trip tells the device nothing, so there is no point
    // stamping and echoing it.
    it('discards one with no send stamp', () => {
      expect(read({ message: 'measure' })).toBeUndefined()
    })

    it('discards one whose send stamp is not a number', () => {
      expect(read({ message: 'measure', t0: '1234' })).toBeUndefined()
    })
  })

  describe('an admin registering', () => {
    it('accepts one naming a performance to follow', () => {
      expect(read({ message: 'isAdmin', performanceId: 'abc' })).toEqual({
        message: 'isAdmin',
        performanceId: 'abc'
      })
    })

    // The admin interface opens its socket before a performance is chosen.
    it('accepts one naming no performance', () => {
      expect(read({ message: 'isAdmin' })).toEqual({ message: 'isAdmin', performanceId: undefined })
    })

    it('discards one whose performance id is not a string', () => {
      expect(read({ message: 'isAdmin', performanceId: 42 })).toBeUndefined()
    })
  })
})
