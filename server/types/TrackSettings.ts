import { TrackMode } from './TrackMode'

/** How a track is rendered: which distribution it uses, and with what voice. */
export interface TrackSettings {
  mode: TrackMode
  waveform: OscillatorType
  ttsRate: number
}
