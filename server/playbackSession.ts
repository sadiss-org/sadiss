import { Frame, TrackSettings } from './types'
import { Types } from 'mongoose'
import { logger, reasonOf } from './tools'
import { Recipient } from './lib/audience'
import { PartialMap } from './partialDistribution'
import { payloadsForChunk } from './chunkPayloads'
import { CHUNK_SECONDS } from './types/ChunkEnvelope'
import { PerformanceLog } from './lib/logRecords'

const CHUNK_INTERVAL_MS = CHUNK_SECONDS * 1000

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
  /**
   * The chunk this run last sent. Recorded rather than worked out from the clock,
   * because a run that falls behind skips the chunks that are already over, so
   * the time since the start does not say which chunk went out last.
   */
  private sentChunk = 0
  /**
   * Ends the run that is going on: set by `start`, and called by `stop` and by
   * the track running out. Set exactly while a run is going on.
   */
  private finish?: (record: { type: 'stop' | 'ended'; trackId: string }) => void
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

  isRunning = () => this.finish !== undefined

  /**
   * Stops a run an admin no longer wants, at once: the devices are told, then
   * the stop is recorded, and no chunk of this run goes out afterwards.
   */
  stop = () => {
    if (!this.finish) return
    logger.info('Sending interval stopped.')
    this.finish({ type: 'stop', trackId: this.trackId })
  }

  /** Where this run has got to, which is what an admin is shown. */
  progress = (): PlaybackProgress =>
    this.isRunning()
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
   * `log` is where the run records its start and how it ended, each after the
   * devices have been told. It is held only while the run goes on.
   *
   * More or less accurate timer taken from https://stackoverflow.com/a/29972322/16725862
   */
  start = (startTime: number, audienceNow: () => Recipient[], log: PerformanceLog) => {
    if (this.isRunning()) {
      return false
    }

    /** Sends the same message to every device playing the performance. */
    const announce = (message: { start: true } | { stop: true }) => {
      for (const device of audienceNow()) {
        device.send(JSON.stringify(message))
      }
    }

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

    /** How many times the track began again since the last chunk went out, to be recorded once it has. */
    let rounds = 0

    /**
     * Sends the current chunk, and says how many devices it went to, how many of
     * its partials none was given, and how long sending took. It runs from a
     * timer, where nothing above catches what it throws, so a chunk that cannot
     * be sent is logged and costs only itself: the next one is sent on time.
     */
    const sendChunk = (devices: Recipient[]) => {
      const currentFrame = this.frames[chunkIndex]
      if (!currentFrame) return undefined

      try {
        const startedAt = performance.now()
        const { messages, nextMap, unassignedPartials } = payloadsForChunk(
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
        return { devices: messages.length, unassignedPartials, sendMs: performance.now() - startedAt }
      } catch (err) {
        logger.error(`Performing ${this.performanceKey}: skipped chunk ${chunkIndex}, which could not be sent: ${reasonOf(err)}`)
        return undefined
      }
    }

    const step = () => {
      logger.info(`Performing ${this.performanceKey} @ chunk ${chunkIndex}`)

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

      let sent: ReturnType<typeof sendChunk>
      if (devices.length) {
        sent = sendChunk(devices)
      } else {
        logger.info('No clients to distribute to.')
        sent = { devices: 0, unassignedPartials: this.frames[chunkIndex]?.partials.length ?? 0, sendMs: 0 }
      }

      for (; rounds > 0; rounds--) log.write({ type: 'loop', trackId: this.trackId })
      if (sent) {
        log.write({ type: 'chunk', index: chunkIndex, lateMs: dt, ...sent, sendMs: Math.round(sent.sendMs * 10) / 10 })
      }

      this.sentChunk = chunkIndex
      chunkIndex++

      expected += CHUNK_INTERVAL_MS
      nextStep = setTimeout(step, Math.max(0, CHUNK_INTERVAL_MS - dt))
    }

    /** The date every chunk of the current round is sent with. */
    const chunkDate = () => actualStartTime + LEAD_SECONDS

    const atEnd = () => chunkIndex >= this.frames.length

    /** On a looping track, moves a position past the end into the round it falls in. */
    const wrapIntoRound = () => {
      const length = this.frames.length
      if (!this.loop || !length || !atEnd()) return
      const passed = Math.floor(chunkIndex / length)
      actualStartTime += passed * length
      chunkIndex -= passed * length
      rounds += passed
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

    /** The next step, while one is due. */
    let nextStep: NodeJS.Timeout | undefined

    this.finish = (record) => {
      this.finish = undefined
      clearTimeout(nextStep)
      partialMap = {}
      chunkIndex = 0

      // Notify all clients of track end
      announce({ stop: true })
      log.write(record)
    }

    // Start
    nextStep = setTimeout(step, CHUNK_INTERVAL_MS)
    log.write({ type: 'start', trackId: this.trackId, loop: this.loop, startAtChunk: this.startAtChunk })

    const handleTrackEnd = () => {
      if (chunkIndex >= this.frames.length) {
        if (this.loop) {
          logger.info('No more chunks. Looping.')
          wrapIntoRound()
          return true
        } else {
          logger.info('No more chunks. Stopping.')
          this.finish?.({ type: 'ended', trackId: this.trackId })
          return false
        }
      }
      return true
    }

    return true
  }
}
