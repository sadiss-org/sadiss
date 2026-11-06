import { Frame, TrackSettings } from './types'
import { Types } from 'mongoose'
import { logger } from './tools'
import { Recipient } from './lib/audience'
import { PartialMap } from './partialDistribution'
import { payloadsForChunk } from './chunkPayloads'

const CHUNK_INTERVAL_MS = 1000

/**
 * How far ahead of its own position a chunk is dated, giving it time to reach a
 * device and be scheduled before it has to sound.
 */
const LEAD_SECONDS = 2

/**
 * Until when, in seconds of track time, a frame has something to play: the end
 * of its partials or the start of its latest phrase, and never before the end
 * of its own second, so frames with nothing in them still pass one per second.
 */
const soundsUntil = (frame: Frame, index: number) =>
  Math.max(
    index + 1,
    ...frame.partials.map((partial) => partial.endTime),
    ...Object.values(frame.ttsInstructions ?? {}).map((instruction) => instruction.time)
  )

/** Where a performance has got to, as an admin is shown it. */
export type PlaybackProgress =
  | { playing: false }
  | { playing: true; trackId: string; chunkIndex: number; totalChunks: number; loop: boolean }

/**
 * One run of one track for one performance.
 *
 * A session is complete the moment it is constructed: the frames it sends, the
 * chunk it starts from and the settings it sends them with are all fixed here
 * and never reassigned. A run is therefore always internally consistent, and a
 * change to the stored start time takes effect on the next session rather than
 * on the one already playing.
 */
export class PlaybackSession {
  private running = false
  /**
   * The chunk this run last sent. Recorded rather than worked out from the clock,
   * because a run that falls behind skips the chunks that are already over, so
   * the time since the start does not say which chunk went out last.
   */
  private sentChunk = 0
  readonly performanceKey: string

  constructor(
    readonly performanceId: Types.ObjectId | string,
    readonly trackId: string,
    readonly frames: Frame[],
    readonly startAtChunk: number,
    readonly loop: boolean,
    readonly settings: TrackSettings
  ) {
    this.performanceKey = String(performanceId)
  }

  isRunning = () => this.running

  stop = () => (this.running = false)

  /** Where this run has got to, which is what an admin is shown. */
  progress = (): PlaybackProgress =>
    this.running
      ? {
          playing: true,
          trackId: this.trackId,
          chunkIndex: this.sentChunk,
          totalChunks: this.frames.length,
          loop: this.loop
        }
      : { playing: false }

  /**
   * Begins sending chunks, one per second. `startTime` is the server's own clock
   * in seconds; devices schedule playback against it.
   *
   * `audienceNow` is read once per chunk, so a device that connects or leaves
   * mid-track is picked up on the next one.
   *
   * More or less accurate timer taken from https://stackoverflow.com/a/29972322/16725862
   */
  start = (startTime: number, audienceNow: () => Recipient[]) => {
    if (this.running) {
      return false
    }

    /** Sends the same message to every device playing the performance. */
    const announce = (message: { start: true } | { stop: true }) => {
      for (const device of audienceNow()) {
        device.send(JSON.stringify(message))
      }
    }

    this.running = true

    announce({ start: true })

    let expected = Date.now() + CHUNK_INTERVAL_MS
    let chunkIndex = this.startAtChunk
    this.sentChunk = this.startAtChunk

    // Offsetting by the start position makes playback begin at the chosen chunk
    // immediately, rather than after a silent run-up. This works because chunks
    // are 1s long. Looping advances it by a whole track length, so repeats keep
    // scheduling into the future.
    let actualStartTime = startTime - this.startAtChunk

    // nonChoir mode: which device held which partial last chunk, so a partial
    // stays with the same device for as long as that device is connected.
    let partialMap: PartialMap = {}

    const sendChunk = (devices: Recipient[]) => {
      const currentFrame = this.frames[chunkIndex]
      if (!currentFrame) {
        return
      }

      const { messages, nextMap } = payloadsForChunk(
        currentFrame,
        devices,
        chunkDate(),
        this.settings,
        partialMap
      )

      for (const { device, json } of messages) {
        device.send(json)
      }

      partialMap = nextMap
    }

    const step = () => {
      logger.info(`Performing ${this.performanceKey} @ chunk ${chunkIndex}`)
      if (!this.running) {
        logger.info('Sending interval stopped.')
        reset()
        return
      }

      const behindMs = Date.now() - expected
      const skipped = skipChunksAlreadyOver()
      if (skipped) {
        expected += skipped * CHUNK_INTERVAL_MS
        logger.warn(`Sending fell ${behindMs} ms behind; skipped ${skipped} chunks that were already over.`)
      }

      const shouldContinue = handleTrackEnd()
      if (!shouldContinue) return

      const dt = Date.now() - expected
      const devices = audienceNow()

      if (devices.length) {
        sendChunk(devices)
      } else {
        logger.info('No clients to distribute to.')
      }

      this.sentChunk = chunkIndex
      chunkIndex++

      expected += CHUNK_INTERVAL_MS
      setTimeout(step, Math.max(0, CHUNK_INTERVAL_MS - dt))
    }

    /** The date every chunk of the current round is sent with. */
    const chunkDate = () => actualStartTime + LEAD_SECONDS

    const atEnd = () => chunkIndex >= this.frames.length

    /** On a looping track, moves a position past the end into the round it falls in. */
    const wrapIntoRound = () => {
      const length = this.frames.length
      if (!this.loop || !length || !atEnd()) return
      const rounds = Math.floor(chunkIndex / length)
      actualStartTime += rounds * length
      chunkIndex -= rounds * length
    }

    /**
     * Moves past every chunk that has already finished sounding, and returns how
     * many that was. A chunk that is late but still has sound ahead of it is
     * kept: devices schedule it by its date, not by when it arrives, so they
     * play what is left of it at the right moment.
     */
    const skipChunksAlreadyOver = () => {
      let skipped = 0
      while (!atEnd() && (chunkDate() + soundsUntil(this.frames[chunkIndex], chunkIndex)) * 1000 <= Date.now()) {
        chunkIndex++
        skipped++
        wrapIntoRound()
      }
      return skipped
    }

    // Start
    setTimeout(step, CHUNK_INTERVAL_MS)

    const reset = () => {
      partialMap = {}
      chunkIndex = 0

      // Notify all clients of track end
      announce({ stop: true })
    }

    const handleTrackEnd = () => {
      if (chunkIndex >= this.frames.length) {
        if (this.loop) {
          logger.info('No more chunks. Looping.')
          wrapIntoRound()
          return true
        } else {
          logger.info('No more chunks. Stopping.')
          this.running = false
          reset()
          return false
        }
      }
      return true
    }

    return true
  }
}
