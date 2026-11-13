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

    const device = {
      id: '1f0e6c3a-6a5b-4c1e-9d55-3c1f2b7a9e10',
      appVersion: '2.2.0',
      appBuild: '12',
      platform: 'android',
      osVersion: '13',
      model: 'MAR-LX1A',
      network: 'wifi'
    }

    it('keeps who the device is when it says', () => {
      const parsed = read({ message: 'clientInfo', clientId: 0, ttsLang, performanceId: 'abc', protocolVersion: 3, device })
      expect(parsed).toMatchObject({ device })
    })

    it('drops keys the device identity was not expected to carry', () => {
      const parsed = read({
        message: 'clientInfo',
        clientId: 0,
        ttsLang,
        performanceId: 'abc',
        device: { ...device, extra: 'x' }
      })
      expect(parsed).toMatchObject({ device })
      expect(parsed).not.toHaveProperty('device.extra')
    })

    // Who a phone is only goes into the log, so a malformed identity costs the
    // log that detail, never the phone its registration.
    it.each([
      ['that is not an object', 'phone'],
      ['with a field that is not a string', { ...device, appBuild: 12 }],
      ['missing a field', { ...device, model: undefined }],
      ['with a field far longer than a real one', { ...device, model: 'x'.repeat(10_000) }]
    ])('registers a device whose identity is malformed, %s, without the identity', (_, malformed) => {
      const parsed = read({ message: 'clientInfo', clientId: 0, ttsLang, performanceId: 'abc', device: malformed })
      expect(parsed).toMatchObject({ message: 'clientInfo', clientId: 0 })
      expect(parsed).not.toHaveProperty('device')
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
    const report = {
      clock: { offsetMs: 12.5, rttMs: 30, roundTrips: 20, connectedForMs: 60000 },
      audio: {
        scheduleOffsetS: 1794334.2,
        calibrationS: 0.12,
        state: 'running',
        outputLatency: 0.04,
        baseLatency: 0.005,
        sampleRate: 48000,
        outputTimestamp: { contextTime: 12.3, performanceTime: 45678.9 },
        restarts: 1
      },
      visible: false,
      keepAlivePlaying: true,
      lastChunk: { index: 7, leadMs: 912.4 },
      tts: [
        { trackTimeS: 4, lang: 'de-DE', rate: 1, askedLateMs: 42.5, tookMs: 1800, error: null },
        { trackTimeS: 9, lang: null, rate: 1, askedLateMs: 30, tookMs: 2, error: 'This language is not supported.' }
      ]
    }

    it('keeps the report a phone sends with it', () => {
      expect(read({ message: 'measure', t0: 5, report })).toEqual({ message: 'measure', t0: 5, report })
    })

    it('keeps a report whose figures the phone could not give', () => {
      const unknown = { clock: null, audio: null, visible: null, keepAlivePlaying: null, lastChunk: null, tts: null }
      expect(read({ message: 'measure', t0: 5, report: unknown })).toEqual({ message: 'measure', t0: 5, report: unknown })
    })

    // The report only goes into the log; the ping is the shared clock and must always be answered.
    it('reads a figure of the wrong kind as unknown, and drops keys it does not expect', () => {
      const parsed = read({
        message: 'measure',
        t0: 5,
        report: {
          ...report,
          visible: 'yes',
          clock: { ...report.clock, rttMs: '30' },
          audio: { ...report.audio, state: 'x'.repeat(500) },
          extra: 1
        }
      })
      expect(parsed).toMatchObject({
        t0: 5,
        report: { visible: null, clock: { rttMs: null, offsetMs: 12.5 }, audio: { state: null } }
      })
      expect(parsed).not.toHaveProperty('report.extra')
    })

    it('reads the phrases of an app that reports none as unknown', () => {
      const { tts: _, ...withoutPhrases } = report
      expect(read({ message: 'measure', t0: 5, report: withoutPhrases })).toMatchObject({ report: { tts: null } })
    })

    it('keeps at most 20 phrases, and drops those that are not objects', () => {
      const phrase = report.tts[0]
      const parsed = read({ message: 'measure', t0: 5, report: { ...report, tts: ['spoken', ...Array(30).fill(phrase)] } })
      expect(parsed).toMatchObject({ report: { tts: Array(20).fill(phrase) } })
    })

    it("reads a phrase's figures of the wrong kind as unknown, and shortens a long error", () => {
      const parsed = read({
        message: 'measure',
        t0: 5,
        report: { ...report, tts: [{ ...report.tts[0], tookMs: 'long', lang: 'x'.repeat(500), error: 'e'.repeat(1000) }] }
      })
      expect(parsed).toMatchObject({ report: { tts: [{ trackTimeS: 4, tookMs: null, lang: null, error: 'e'.repeat(200) }] } })
    })

    it('answers a ping whose report is not an object, without the report', () => {
      expect(read({ message: 'measure', t0: 5, report: 'broken' })).toEqual({ message: 'measure', t0: 5 })
    })

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
