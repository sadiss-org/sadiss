import { describe, expect, it } from 'vitest'
import { planRoom } from '../src/room'
import { TrackShape } from '../src/track'

const choir = (voices: number, langs: string[]): TrackShape => ({
  seconds: 30,
  partialsPerFrame: voices,
  choir: true,
  tts: langs.length ? { langs, everySeconds: 4 } : null
})

describe('the seats of a room', () => {
  it('hands out choir ids the way one QR code per voice does, every voice in every language', () => {
    const seats = planRoom({ phones: 12, track: choir(3, ['en-US', 'de-DE']), lateShare: 0 })
    expect(seats.map((seat) => seat.choirId)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2])
    const pairs = new Set(seats.map((seat) => `${seat.choirId} ${seat.ttsLang.iso}`))
    expect(pairs).toEqual(new Set(['0 en-US', '1 en-US', '2 en-US', '0 de-DE', '1 de-DE', '2 de-DE']))
  })

  it('lets the given share of phones join during the track, and the rest before it', () => {
    const seats = planRoom({ phones: 20, track: choir(4, []), lateShare: 0.1 })
    expect(seats.filter((seat) => seat.late)).toHaveLength(2)
    expect(seats.slice(0, 18).every((seat) => !seat.late)).toBe(true)
  })

  it('gives every phone choir id 0 outside choir mode, as the single QR code of a nonChoir performance does', () => {
    const track: TrackShape = { seconds: 30, partialsPerFrame: 16, choir: false, tts: null }
    expect(planRoom({ phones: 3, track, lateShare: 0 }).map((seat) => seat.choirId)).toEqual([0, 0, 0])
  })

  it('sends no language when the track has no phrases, as the app does when its QR code offers none', () => {
    const [seat] = planRoom({ phones: 2, track: choir(2, []), lateShare: 0 })
    expect(seat?.ttsLang).toEqual({ iso: '', lang: '' })
  })
})
