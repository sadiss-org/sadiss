export interface TrackShape {
  /** Length of the track in seconds. */
  seconds: number
  /**
   * How many partials sound in every frame. In nonChoir mode the server shares
   * a frame's partials out over the connected phones, at most 16 each, so this
   * and the number of phones together set how much each phone is sent. In choir
   * mode each partial is one voice.
   */
  partialsPerFrame: number
  /**
   * Choir mode: a phone plays the partial whose index is its choir id, and hears
   * the phrases written for that voice. Otherwise the track is in nonChoir mode.
   */
  choir: boolean
  /** Phrases for every voice in each of these languages (ISO codes such as en-US), one every `everySeconds`; null for a track without TTS. */
  tts: { langs: string[]; everySeconds: number } | null
}

const FRAME_STEP_S = 0.01

/**
 * Where in its chunk a phrase sounds. The server files a phrase under the chunk
 * its time falls in, one phrase per voice and chunk, so phrases at least a chunk
 * apart each keep their own.
 */
const PHRASE_INTO_CHUNK_S = 0.5

/**
 * A partials file in the text format the server reads on upload (as SPEAR
 * exports it): every partial sounds through the whole track, one frame every
 * 10 ms, each partial at its own steady pitch.
 */
export const partialFile = ({ seconds, partialsPerFrame }: TrackShape) => {
  const frameCount = Math.round(seconds / FRAME_STEP_S)
  const lines = [
    'par-text-frame-format',
    'point-type index frequency amplitude',
    `partials-count ${partialsPerFrame}`,
    `frame-count ${frameCount}`,
    'frame-data'
  ]
  for (let frame = 0; frame < frameCount; frame++) {
    const triples = Array.from({ length: partialsPerFrame }, (_, index) => `${index} ${(220 + index * 55).toFixed(6)} 0.010000`)
    lines.push(`${(frame * FRAME_STEP_S).toFixed(6)} ${partialsPerFrame} ${triples.join(' ')}`)
  }
  return `${lines.join('\n')}\n`
}

/** One phrase of a track: which voice speaks it, and when, in seconds of track time. */
export interface Phrase {
  voice: number
  time: number
}

/**
 * Every phrase of a track. In choir mode each voice has its own; in nonChoir
 * mode the server reads every phone the phrase of the first voice, so only
 * voice 0 has phrases.
 */
export const phrases = ({ seconds, partialsPerFrame, choir, tts }: TrackShape): Phrase[] => {
  if (!tts) return []
  const voices = choir ? partialsPerFrame : 1
  const times: number[] = []
  for (let time = PHRASE_INTO_CHUNK_S; time < seconds; time += tts.everySeconds) times.push(Number(time.toFixed(3)))
  return Array.from({ length: voices }, (_, voice) => times.map((time) => ({ voice, time }))).flat()
}

/** The text of a phrase, which names its voice, language and time, so a phone can tell when it was sent the wrong one. */
export const phraseText = (voice: number, lang: string, time: number) => `voice ${voice} ${lang} at ${time}`

const srtTimestamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/**
 * The TTS files of a track, one SRT file per voice and language. The upload
 * reads the voice and the language from the file name, `ttsfile_<voice>_<lang>_<name>`,
 * split at underscores, so neither may contain one.
 */
export const ttsFiles = (track: TrackShape): { name: string; content: string }[] => {
  const all = phrases(track)
  const voices = [...new Set(all.map((phrase) => phrase.voice))]
  return (track.tts?.langs ?? []).flatMap((lang) =>
    voices.map((voice) => {
      const entries = all
        .filter((phrase) => phrase.voice === voice)
        .map(({ time }, index) => `${index + 1}\n${srtTimestamp(time)} --> ${srtTimestamp(time + 0.4)}\n${phraseText(voice, lang, time)}\n`)
      return { name: `ttsfile_${voice}_${lang}_loadtest`, content: entries.join('\n') }
    })
  )
}
