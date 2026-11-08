import { describe, expect, it } from 'vitest'
import { Audience } from '../src/audience'
import { watch } from '../src/results'
import { phraseText, TrackShape } from '../src/track'
import { VirtualPhone } from '../src/virtualPhone'

const TRACK: TrackShape = { seconds: 1, partialsPerFrame: 1, choir: false, tts: null }
const STARTED_AT_MS = 100_000

const phone = (overrides: Partial<VirtualPhone> = {}): VirtualPhone => ({
  seat: { choirId: 0, ttsLang: { iso: 'en-US', lang: 'en-US' }, late: false },
  joinedAtMs: 0,
  firstLiveAtMs: 10,
  arrivals: [{ chunk: 0, leadMs: 900 }],
  phrases: [],
  connects: 1,
  drops: 0,
  roundTripsMs: [],
  offsetMs: () => 0,
  close: () => undefined,
  ...overrides
})

const audienceOf = (phones: VirtualPhone[]): Audience => ({
  phones,
  join: () => {
    throw new Error('not used')
  },
  leave: () => undefined
})

const watchFrom = (audience: Audience) => watch(audience, () => STARTED_AT_MS)

const arrivals = (...chunks: number[]) => chunks.map((chunk) => ({ chunk, leadMs: 900 }))

describe('the drops of a run', () => {
  it('counts only the drops from the start of the track until it is stopped, and reports the drops before it on their own', () => {
    const early = phone({ drops: 2 })
    const audience = audienceOf([early, phone()])
    const watching = watchFrom(audience)
    early.drops++
    const result = watching.finish(TRACK, 1)
    expect(result.dropsDuringTrack).toBe(1)
    expect(result.dropsBeforeTrack).toBe(2)
  })
})

describe('a phone that joins during the track', () => {
  const late = (chunks: number[], firstLiveAtMs: number | null) =>
    phone({ joinedAtMs: STARTED_AT_MS + 2000, firstLiveAtMs, arrivals: arrivals(...chunks) })

  const runWith = (latePhone: VirtualPhone) => {
    const phones = [phone({ arrivals: arrivals(0, 1, 2, 3, 4, 5) }), phone({ arrivals: arrivals(0, 1, 2, 3, 4, 5) })]
    const watching = watchFrom(audienceOf(phones))
    phones.push(latePhone)
    return watching.finish(TRACK, 6)
  }

  // Live 2.5 s after the start, the next chunk the server sends is chunk 2, one per second from 1 s after the start.
  // That one may race the phone's registration, so the phone is expected to receive every chunk from the one after.
  it('is expected to receive every chunk after the next one the server sends once it went live', () => {
    expect(runWith(late([3, 4, 5], STARTED_AT_MS + 2500)).missingChunks).toBe(0)
    expect(runWith(late([4, 5], STARTED_AT_MS + 2500)).missingChunks).toBe(1)
  })

  it('is counted from when it joined when it never went live', () => {
    expect(runWith(late([], null)).missingChunks).toBe(3)
  })

  it('is counted as a late phone', () => {
    expect(runWith(late([3, 4, 5], STARTED_AT_MS + 2500)).latePhones).toBe(1)
  })

  it('has its clock offset measured against the phones that joined before the track, apart from theirs', () => {
    const phones = [phone({ offsetMs: () => 0 }), phone({ offsetMs: () => 0 }), phone({ offsetMs: () => 2 })]
    const watching = watchFrom(audienceOf(phones))
    phones.push(phone({ offsetMs: () => 30 }))
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        const result = watching.finish(TRACK, 1)
        expect(result.offsetFromMedianMs.max).toBe(2)
        expect(result.lateOffsetFromMedianMs.max).toBe(30)
        resolve()
      }, 1100)
    )
  })
})

describe('the phrases of a run', () => {
  const tts: TrackShape = { seconds: 9, partialsPerFrame: 2, choir: true, tts: { langs: ['en-US', 'de-DE'], everySeconds: 4 } }
  const voice1German = { choirId: 1, ttsLang: { iso: 'de-DE', lang: 'de-DE' }, late: false }
  const heard = (time: number, text: string | null = phraseText(1, 'de-DE', time), leadMs: number | null = 1400) => ({ time, text, leadMs })

  const resultFor = (overrides: Partial<VirtualPhone>) => {
    const audience = audienceOf([phone({ seat: voice1German, ...overrides }), phone({ seat: voice1German, phrases: [heard(0.5), heard(4.5), heard(8.5)] })])
    return watchFrom(audience).finish(tts, 9)
  }

  it('finds nothing wrong when every phone hears every phrase of its voice in its language', () => {
    const result = resultFor({ phrases: [heard(0.5), heard(4.5), heard(8.5)] })
    expect(result).toMatchObject({ missingPhrases: 0, wrongPhrases: 0, phraseLeadMs: { count: 6, min: 1400 } })
  })

  it('counts a phrase of the phone’s voice it never heard as missing', () => {
    expect(resultFor({ phrases: [heard(0.5), heard(8.5)] }).missingPhrases).toBe(1)
  })

  it('counts a phrase in another voice or language, or without its text, as wrong, not as missing', () => {
    const result = resultFor({ phrases: [heard(0.5, phraseText(0, 'de-DE', 0.5)), heard(4.5, phraseText(1, 'en-US', 4.5)), heard(8.5, null)] })
    expect(result).toMatchObject({ missingPhrases: 0, wrongPhrases: 3 })
  })

  it('counts a phrase at a time the track has none as wrong', () => {
    expect(resultFor({ phrases: [heard(0.5), heard(4.5), heard(8.5), heard(2.5)] }).wrongPhrases).toBe(1)
  })

  it('leaves phrases heard before the phone had a clock out of how early they arrived', () => {
    expect(resultFor({ phrases: [heard(0.5, undefined, null), heard(4.5), heard(8.5)] }).phraseLeadMs.count).toBe(5)
  })

  it('expects a late phone to hear only the phrases from the chunk after it went live', () => {
    const late = phone({ seat: voice1German, joinedAtMs: STARTED_AT_MS + 3000, firstLiveAtMs: STARTED_AT_MS + 3200, phrases: [heard(8.5)] })
    const phones = [phone({ seat: voice1German, phrases: [heard(0.5), heard(4.5), heard(8.5)] }), phone({ seat: voice1German, phrases: [heard(0.5), heard(4.5), heard(8.5)] })]
    const watching = watchFrom(audienceOf(phones))
    phones.push(late)
    expect(watching.finish(tts, 9).missingPhrases).toBe(1)
  })
})
