import { Document, Types } from 'mongoose'
import { TTSFileObject } from './TtsFileObject'
import { TrackMode } from './TrackMode'

export interface TrackDocument extends Document {
  _id: Types.ObjectId
  name: string
  chunks: string
  chunkFileName: string
  trackLengthInChunks: number
  partialsCount: number
  mode: TrackMode
  notes: string
  ttsInstructions: string
  ttsLangs: string[]
  waveform: OscillatorType
  ttsRate: number
  partialFile: {
    origName: string
    fileName: string
  }
  ttsFiles: TTSFileObject[]
  isPublic: boolean
  creator: Types.ObjectId
  deleted: boolean
  deletedAt: Date
  deletedBy: Types.ObjectId
}
