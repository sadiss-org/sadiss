import { ChunkEnvelope } from '@/types/types'

/** How much of a track one chunk carries, in seconds, as the server sends them (server/types/ChunkEnvelope.ts). */
export const CHUNK_SECONDS = 1

/** Which chunk of the track a message carries, and when its first sound is due. */
export interface ChunkTiming {
  chunk: number
  /** Server time, in ms, at which the chunk's first partial starts. */
  soundsAtServerMs: number
}

/**
 * Reads a chunk message the way a phone schedules it: the track starts at the
 * envelope's `startTime` and each partial at its own track time. A chunk's
 * number is the stretch of `CHUNK_SECONDS` its first sound falls in.
 * A chunk without partials, such as one carrying only a phrase, has no timing.
 */
export const chunkTiming = (message: ChunkEnvelope): ChunkTiming | null => {
  const partials = message.chunk.partials ?? []
  if (!partials.length) return null
  const firstSound = Math.min(...partials.map((partial) => partial.startTime))
  return { chunk: Math.floor(firstSound / CHUNK_SECONDS + 1e-6), soundsAtServerMs: (message.startTime + firstSound) * 1000 }
}

/**
 * How long before it is due something arrived, in ms, by the phone's estimate
 * of the server clock: `offsetMs` is server time minus the phone's `nowMs`.
 * Null while the phone has no estimate. Negative when it arrived late.
 */
export const chunkLeadMs = (soundsAtServerMs: number, nowMs: number, offsetMs: number | null) =>
  offsetMs === null ? null : soundsAtServerMs - (nowMs + offsetMs)
