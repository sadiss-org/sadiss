import { TrackShape } from './track'

/** Where one phone of the audience sits: the voice its QR code gave it, the language it speaks, and whether it arrives during the track. */
export interface Seat {
  choirId: number
  ttsLang: { iso: string; lang: string }
  /** Joins during the track instead of before it. */
  late: boolean
}

/**
 * The seats of a room of `phones` phones, in the order they join. In choir mode
 * every voice has its own QR code, and people take whichever is in front of
 * them, so voices go round in join order, and languages go round once per
 * round of voices, which gives every voice in every language. Outside choir
 * mode the single QR code carries no choir id, so every phone plays as 0.
 * The last `lateShare` of them join during the track.
 */
export const planRoom = ({ phones, track, lateShare }: { phones: number; track: TrackShape; lateShare: number }): Seat[] => {
  const voices = track.choir ? track.partialsPerFrame : 1
  const langs = track.tts?.langs ?? []
  const late = Math.round(phones * lateShare)
  return Array.from({ length: phones }, (_, index) => {
    // The app sends an empty language when its QR code offers none.
    const iso = langs[Math.floor(index / voices) % langs.length] ?? ''
    return { choirId: index % voices, ttsLang: { iso, lang: iso }, late: index >= phones - late }
  })
}
