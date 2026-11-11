import { parseArgs } from 'node:util'
import { MIN_PHONES } from './stats'
import { TrackShape } from './track'

export interface Options {
  apiUrl: string
  wsUrl: string
  /** How many phones a run has; for a ramp, its first step. */
  phones: number
  track: TrackShape
  /** Over how long the phones that join before the track do so, in ms. */
  joinOverMs: number
  /** The share of phones that join during the first half of the track instead of before it. */
  lateShare: number
  /** How long the phones measure their clocks after the last one joined, before the track starts, in ms. */
  settleMs: number
  /** The commit the server under test runs, when given instead of found (see `findServerCommit`). */
  serverCommit: string | undefined
  /** Kept in the results file with the run. */
  note: string | null
  /** A ramp of rooms with `start`, `start + step`, ... phones instead of one run; null for one run. */
  ramp: { start: number; step: number } | null
}

const number = (option: string, value: string, { atLeast, whole }: { atLeast: number; whole: boolean }) => {
  // Number('') is 0, so an empty value has to be refused before it is read.
  const parsed = value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isFinite(parsed) || parsed < atLeast || (whole && !Number.isInteger(parsed))) {
    throw new Error(`--${option} must be ${whole ? 'a whole number' : 'a number'} of at least ${atLeast}, not "${value}".`)
  }
  return parsed
}

/** The upload reads a TTS file's language from its name, split at underscores, so a language may not contain one. */
const languages = (value: string) => {
  const langs = value.split(',').map((lang) => lang.trim())
  if (langs.some((lang) => lang === '' || lang.includes('_'))) {
    throw new Error(`--langs must be ISO codes separated by commas, such as en-US,de-DE, not "${value}".`)
  }
  return langs
}

/**
 * Reads the command line. A value that is not a number would make a run with
 * no phones or no chunks, which reports nothing wrong, so it is refused.
 */
export const parseOptions = (args: string[]): Options => {
  const { values } = parseArgs({
    args,
    options: {
      api: { type: 'string', default: 'http://127.0.0.1:3000' },
      ws: { type: 'string', default: 'ws://127.0.0.1:8080' },
      phones: { type: 'string' },
      seconds: { type: 'string', default: '30' },
      partials: { type: 'string' },
      voices: { type: 'string' },
      langs: { type: 'string' },
      'phrase-every': { type: 'string' },
      'join-over': { type: 'string', default: '5' },
      'late-share': { type: 'string', default: '0.1' },
      // The app's clock keeps its last 20 round trips, one every 3 s, so its
      // estimate is settled about a minute after a phone joins.
      settle: { type: 'string', default: '60' },
      'server-commit': { type: 'string' },
      note: { type: 'string' },
      ramp: { type: 'boolean', default: false },
      'ramp-start': { type: 'string' },
      'ramp-step': { type: 'string' }
    }
  })

  if (values.voices !== undefined && values.partials !== undefined) {
    throw new Error('--voices and --partials cannot be given together: in choir mode every partial is a voice.')
  }
  if (values['phrase-every'] !== undefined && values.langs === undefined) {
    throw new Error('--phrase-every needs --langs, the languages the phrases are written in.')
  }
  const voices = values.voices === undefined ? null : number('voices', values.voices, { atLeast: 1, whole: true })
  const partials = number('partials', values.partials ?? '16', { atLeast: 1, whole: true })
  const everySeconds = number('phrase-every', values['phrase-every'] ?? '4', { atLeast: 1, whole: false })

  if (!values.ramp && (values['ramp-start'] !== undefined || values['ramp-step'] !== undefined)) {
    throw new Error('--ramp-start and --ramp-step need --ramp.')
  }
  if (values.ramp && values.phones !== undefined) {
    throw new Error('--phones cannot be given with --ramp, which sets the phones of each step from --ramp-start and --ramp-step.')
  }
  const ramp = values.ramp
    ? {
        start: number('ramp-start', values['ramp-start'] ?? '25', { atLeast: MIN_PHONES, whole: true }),
        step: number('ramp-step', values['ramp-step'] ?? '25', { atLeast: 1, whole: true })
      }
    : null
  const phones = ramp?.start ?? number('phones', values.phones ?? '10', { atLeast: MIN_PHONES, whole: true })
  const lateShare = number('late-share', values['late-share'], { atLeast: 0, whole: false })
  if (phones - Math.round(phones * lateShare) < MIN_PHONES) {
    throw new Error(`--late-share ${lateShare} leaves fewer than ${MIN_PHONES} of ${phones} phones joining before the track, too few to measure their clocks against.`)
  }

  return {
    apiUrl: values.api,
    wsUrl: values.ws,
    phones,
    track: {
      seconds: number('seconds', values.seconds, { atLeast: 1, whole: true }),
      partialsPerFrame: voices ?? partials,
      choir: voices !== null,
      tts: values.langs === undefined ? null : { langs: languages(values.langs), everySeconds }
    },
    joinOverMs: number('join-over', values['join-over'], { atLeast: 0, whole: false }) * 1000,
    lateShare,
    settleMs: number('settle', values.settle, { atLeast: 0, whole: false }) * 1000,
    serverCommit: values['server-commit'],
    note: values.note ?? null,
    ramp
  }
}
