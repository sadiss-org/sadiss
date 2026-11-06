import { PartialChunk } from './PartialChunk'

/** The audio and speech a device is given for one chunk. */
export interface Chunk {
  partials?: PartialChunk[]
  ttsInstructions?: { time: number; phrase: string }
}

/**
 * One chunk's message to one device, as it goes over the wire. `startTime` is
 * the server time, in seconds, that the track's time 0 is scheduled at; every
 * time inside `chunk` is track time.
 *
 * Released apps parse this shape, so it only ever grows.
 */
export interface ChunkEnvelope {
  startTime: number
  waveform: string
  ttsRate: number
  chunk: Chunk
}
