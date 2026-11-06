import type { ChunkEnvelope } from '@server/types/ChunkEnvelope'

/** Which chunk of the track a message carries, and when its first sound is due. */
export interface ChunkTiming {
  chunk: number
  /** Server time, in ms, at which the chunk's first partial starts. */
  soundsAtServerMs: number
}

/**
 * Reads a chunk message the way a phone schedules it: the track starts at the
 * envelope's `startTime` and each partial at its own track time. Chunks are one
 * second of the track each, so a chunk's number is the second it starts in.
 * A chunk without partials, such as one carrying only a phrase, has no timing.
 */
export const chunkTiming = (message: ChunkEnvelope): ChunkTiming | null => {
  const partials = message.chunk.partials ?? []
  if (!partials.length) return null
  const firstSound = Math.min(...partials.map((partial) => partial.startTime))
  return { chunk: Math.floor(firstSound + 1e-6), soundsAtServerMs: (message.startTime + firstSound) * 1000 }
}
