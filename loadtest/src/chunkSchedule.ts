import { CHUNK_SECONDS } from '@server/types/ChunkEnvelope'

const CHUNK_MS = CHUNK_SECONDS * 1000

/**
 * When the server sends a chunk of a track, in ms after the track started: one
 * chunk's time after it sent the chunk before, the first a chunk after the start.
 */
export const chunkSentAtMs = (chunk: number) => (chunk + 1) * CHUNK_MS

/** The first chunk the server sends after `ms` into the track; before the start, the track's first chunk. */
export const firstChunkSentAfter = (ms: number) => Math.max(0, Math.floor(ms / CHUNK_MS))

/**
 * The window a track's traffic is measured in, in ms after it started: the
 * track's length, from half a chunk before its first chunk is sent to half a
 * chunk after its last, so it holds every chunk once as long as each reaches
 * the phones within half a chunk of its time.
 */
export const trackWindow = (chunkCount: number) => ({
  fromMs: chunkSentAtMs(0) - CHUNK_MS / 2,
  toMs: chunkSentAtMs(chunkCount - 1) + CHUNK_MS / 2
})
