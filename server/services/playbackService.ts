import { Types } from 'mongoose'
import { Frame, TrackDocument } from '../types'
import { PlaybackProgress, PlaybackSession } from '../playbackSession'
import { SadissWebSocketServer } from '../lib/SadissWebsocket'
import { webSocketAudience } from '../lib/audience'
import { readAndParseChunkFile } from './fileService'
import { trackRepository } from '../repositories/TrackRepository'
import { trackPerformanceRepository } from '../repositories/TrackPerformanceRepository'
import { NotFoundError } from '../errors/NotFoundError'
import { ProcessingError } from '../errors/ProcessingError'
import { performanceLogFiles } from './performanceLogFiles'

/** The session currently playing for a performance, if any. */
const sessions = new Map<string, PlaybackSession>()

/** Parsed chunk files, so starting a track does not have to wait on disk. */
const frameCache = new Map<string, Frame[]>()

const key = (id: Types.ObjectId | string) => String(id)

export const getSession = (performanceId: Types.ObjectId | string) => sessions.get(key(performanceId))

export const runningSessionCount = () => Array.from(sessions.values()).filter((session) => session.isRunning()).length

/** Where a performance has got to, or that nothing is playing for it. */
export const progressOf = (performanceId: Types.ObjectId | string): PlaybackProgress =>
  sessions.get(key(performanceId))?.progress() ?? { playing: false }

/** Frames for a track, read from disk on a cache miss. */
export const getFrames = async (track: TrackDocument) => {
  const cached = frameCache.get(key(track._id))
  if (cached) {
    return cached
  }

  const frames = await readAndParseChunkFile(track)
  if (!frames) {
    throw new ProcessingError('Error loading track.')
  }

  frameCache.set(key(track._id), frames)
  return frames
}

/**
 * Builds a session for a track in a performance, reading the start position and
 * track settings as they stand now.
 */
export const createSession = async (trackId: Types.ObjectId, performanceId: Types.ObjectId, loop: boolean) => {
  const track = await trackRepository.findById(trackId)
  if (!track) {
    throw new NotFoundError('Track not found.')
  }

  const trackPerformance = await trackPerformanceRepository.findByTrackAndPerformance(trackId, performanceId)
  if (!trackPerformance) {
    throw new NotFoundError('Track performance not found.')
  }

  const frames = await getFrames(track)

  return new PlaybackSession(performanceId, String(trackId), frames, trackPerformance.startTime, loop, {
    mode: track.mode,
    waveform: track.waveform,
    ttsRate: track.ttsRate
  })
}

/**
 * Registers a session as the one playing for its performance and starts it.
 * Returns false if that performance is already playing, leaving it untouched.
 */
export const startSession = (session: PlaybackSession, startTime: number, wss: SadissWebSocketServer) => {
  const running = sessions.get(session.performanceKey)
  if (running?.isRunning()) {
    return false
  }

  sessions.set(session.performanceKey, session)
  return session.start(
    startTime,
    webSocketAudience(wss, session.performanceKey),
    performanceLogFiles.for(session.performanceKey)
  )
}

/** Stops and discards the session for a performance. Returns false if none was playing. */
export const stopSession = (performanceId: Types.ObjectId | string) => {
  const session = sessions.get(key(performanceId))
  if (!session) {
    return false
  }

  session.stop()
  sessions.delete(key(performanceId))
  return true
}
