/** The audio and speech one chunk gives this phone, as the server sends it (server/types/ChunkEnvelope.ts). */
export interface Chunk {
  partials?: PartialChunk[]
  ttsInstructions?: { time: number; phrase: string }
}

/**
 * One chunk's message to this phone, as it comes over the wire. `startTime` is
 * the server time, in seconds, that the track's time 0 is scheduled at; every
 * time inside `chunk` is track time.
 */
export interface ChunkEnvelope {
  startTime: number
  waveform: string
  ttsRate: number
  chunk: Chunk
}

export interface PartialChunk {
  index: number
  startTime: number
  endTime: number
  breakpoints: Breakpoint[]
}

export interface Breakpoint {
  time: number
  freq: number
  amp: number
}

export interface OscillatorObject {
  index: number
  oscillator: OscillatorNode
  gain: GainNode
  endTime: number
  lastGain: number
}

export interface TtsInstruction {
  startTime: number
  text: string
  voice: number
}

export type ClientTtsInstruction = Omit<TtsInstruction, 'voice'>

export interface AvailableLanguage {
  iso: string
  lang: string
}

export interface QrCodeScanResult {
  performanceName: string
  performanceId: string
  choirId?: string
  tts?: AvailableLanguage[]
  roleName?: string
  defaultLang?: string
  expertMode?: boolean
  wsUrl: string
}
