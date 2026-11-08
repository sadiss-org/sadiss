import { RunResult } from './results'

export const ms = (value: number | null) => (value === null ? '-' : `${Number(value.toFixed(2))} ms`)
export const count = (value: number | null) => (value === null ? '-' : String(Math.round(value)))

/** How each figure of a run is named and shown, in the figure lines, the check lines and the comparison of runs alike. */
export const FIGURES: Record<keyof RunResult, { label: string; unit: (value: number | null) => string }> = {
  phones: { label: 'Phones', unit: count },
  latePhones: { label: 'Phones joined during the track', unit: count },
  track: { label: 'Track', unit: count },
  chunkCount: { label: 'Chunks in the track', unit: count },
  arrivalLeadMs: { label: 'Arrival before sound', unit: ms },
  offsetFromMedianMs: { label: 'Clock offset off the median', unit: ms },
  lateOffsetFromMedianMs: { label: 'Late phones off the median', unit: ms },
  phraseLeadMs: { label: 'Phrase before its time', unit: ms },
  phrasesWithoutClock: { label: 'Phrases before a clock', unit: count },
  missingPhrases: { label: 'Missing phrases', unit: count },
  wrongPhrases: { label: 'Wrong phrases', unit: count },
  roundTripMs: { label: 'Measurement round trip', unit: ms },
  roundTripsAtStart: { label: 'Round trips at track start', unit: count },
  missingChunks: { label: 'Missing chunks', unit: count },
  arrivalsWithoutClock: { label: 'Chunks before a clock', unit: count },
  connects: { label: 'Connects', unit: count },
  dropsDuringTrack: { label: 'Drops during the track', unit: count },
  dropsBeforeTrack: { label: 'Drops before the track', unit: count },
  generatorDelayMs: { label: 'Generator event loop', unit: ms }
}
