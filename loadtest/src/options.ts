import { parseArgs } from 'node:util'
import { TrackShape } from './track'

export interface Options {
  apiUrl: string
  wsUrl: string
  phones: number
  track: TrackShape
  /** Over how long the phones join, in ms. */
  joinOverMs: number
  /** How long the phones measure their clocks after the last one joined, before the track starts, in ms. */
  settleMs: number
}

const number = (option: string, value: string, { atLeast, whole }: { atLeast: number; whole: boolean }) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < atLeast || (whole && !Number.isInteger(parsed))) {
    throw new Error(`--${option} must be ${whole ? 'a whole number' : 'a number'} of at least ${atLeast}, not "${value}".`)
  }
  return parsed
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
      phones: { type: 'string', default: '10' },
      seconds: { type: 'string', default: '30' },
      partials: { type: 'string', default: '16' },
      'join-over': { type: 'string', default: '5' },
      // The app's clock keeps its last 20 round trips, one every 3 s, so its
      // estimate is settled about a minute after a phone joins.
      settle: { type: 'string', default: '60' }
    }
  })
  return {
    apiUrl: values.api,
    wsUrl: values.ws,
    phones: number('phones', values.phones, { atLeast: 1, whole: true }),
    track: {
      seconds: number('seconds', values.seconds, { atLeast: 1, whole: true }),
      partialsPerFrame: number('partials', values.partials, { atLeast: 1, whole: true })
    },
    joinOverMs: number('join-over', values['join-over'], { atLeast: 0, whole: false }) * 1000,
    settleMs: number('settle', values.settle, { atLeast: 0, whole: false }) * 1000
  }
}
