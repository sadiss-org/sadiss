/** A partial as the server sends it inside a chunk. */
export interface ChunkPartial {
  index: number
  startTime: number
  endTime: number
  breakpoints: { time: number; freq: number; amp: number }[]
}

/**
 * A chunk message as the server sends it. `startTime` is the server time, in
 * seconds, that the track's time 0 is scheduled at; partial times are track time.
 */
export interface ChunkMessage {
  startTime: number
  chunk: { partials?: ChunkPartial[]; ttsInstructions?: { time: number; phrase: string } }
}

/** When, in track seconds, the chunk's first sound starts. */
const firstSound = (message: ChunkMessage) => Math.min(...(message.chunk.partials ?? []).map((partial) => partial.startTime))

/**
 * How many milliseconds before its first sound a chunk arrived, judged as the
 * phone judges it: by its own estimate of the server clock. Negative when the
 * chunk arrived after it should have started.
 *
 * @param arrivedAtMs the phone's local clock when the chunk arrived
 * @param offsetMs    the phone's estimate of server time minus local time
 */
export const arrivalLeadMs = (message: ChunkMessage, arrivedAtMs: number, offsetMs: number) =>
  (message.startTime + firstSound(message)) * 1000 - (arrivedAtMs + offsetMs)

/** Which chunk of the track a message carries: chunks are one second each. */
export const chunkNumber = (message: ChunkMessage) => Math.floor(firstSound(message) + 1e-6)

/** Linear interpolation between the closest ranks, as most statistics tools do. */
const percentile = (sorted: number[], p: number) => {
  const rank = p * (sorted.length - 1)
  const below = Math.floor(rank)
  const lower = sorted[below] ?? Number.NaN
  const upper = sorted[Math.min(below + 1, sorted.length - 1)] ?? lower
  return Number((lower + (upper - lower) * (rank - below)).toFixed(6))
}

export interface Summary {
  count: number
  min: number | null
  median: number | null
  p95: number | null
  p99: number | null
  max: number | null
}

export const summarize = (values: number[]): Summary => {
  if (!values.length) return { count: 0, min: null, median: null, p95: null, p99: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null
  }
}

/**
 * How far apart the phones' clock offsets are at one moment, in ms. All virtual
 * phones of a run share one physical clock, so a perfect clock sync would give
 * them identical offsets; the spread is the sync's error. Phones without an
 * estimate yet are left out.
 */
export const spread = (offsets: (number | null)[]) => {
  const known = offsets.filter((offset): offset is number => offset !== null)
  return known.length < 2 ? null : Math.max(...known) - Math.min(...known)
}
