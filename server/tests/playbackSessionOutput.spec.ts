import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { PerformanceLog } from '../lib/logRecords'
import { Recipient } from '../lib/audience'
import { Frame, PartialChunk, TrackSettings } from '../types'

/** A log that keeps nothing, for runs whose records these tests do not read. */
const noLog: PerformanceLog = { write: () => undefined }

/**
 * The exact messages a track run sends, chunk by chunk.
 *
 * Released apps parse these messages, so their shape is a contract and these
 * tests spell it out in full.
 *
 * No sockets are involved. The session is handed a stand-in for its listeners,
 * which records what it was sent, and the clock is moved by hand — so a chunk
 * costs a line of test rather than a real second.
 */

const PERFORMANCE_ID = '650000000000000000000001'

const CHUNK_MS = 1000

const settings = (overrides: Partial<TrackSettings> = {}): TrackSettings => ({
  mode: 'choir',
  waveform: 'sine',
  ttsRate: 1,
  ...overrides
})

const partial = (index: number): PartialChunk => ({
  index,
  startTime: 0,
  endTime: 1,
  breakpoints: [{ time: 0, freq: 100 + index, amp: 0.5 }]
})

const frame = (partials: PartialChunk[], ttsInstructions = {}): Frame => ({ partials, ttsInstructions })

/** A connection that records the messages it was sent, already parsed. */
const listener = (id: string, attributes: Partial<Pick<Recipient, 'choirId' | 'ttsLang'>> = {}) => {
  const received: any[] = []

  return {
    id,
    choirId: attributes.choirId ?? -1,
    ttsLang: attributes.ttsLang ?? { iso: 'en-US', lang: 'English' },
    received,
    send: (data: string) => received.push(JSON.parse(data))
  }
}

type Listener = ReturnType<typeof listener>

/** An audience whose membership the test can change between chunks. */
const audienceOf = (devices: Listener[]) => {
  const roster = { devices }
  return {
    roster,
    read: (): Recipient[] => roster.devices
  }
}

/** Advances past `count` chunk boundaries, letting the session send each one. */
const playChunks = (count: number) => vi.advanceTimersByTime(count * CHUNK_MS)

describe('what a playback session sends', () => {
  beforeEach(() => {
    // The global setup runs self-advancing timers; stepping chunk by chunk needs
    // the clock to move only when this test says so.
    vi.useFakeTimers()
    // Sessions are started at 100 s below, and a start time is the server's own
    // clock, so the clock reads 100 s when they start.
    vi.setSystemTime(100 * 1000)
  })

  describe('in choir mode', () => {
    it('tells every device that it started', () => {
      const one = listener('one')
      const two = listener('two')
      const audience = audienceOf([one, two])
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', [frame([partial(0)])], 0, false, settings())

      session.start(100, audience.read, noLog)

      expect(one.received).toEqual([{ start: true }])
      expect(two.received).toEqual([{ start: true }])
    })

    it('sends each device the partial carrying its own choir id', () => {
      const soprano = listener('soprano', { choirId: 0 })
      const alto = listener('alto', { choirId: 1 })
      const audience = audienceOf([soprano, alto])
      const session = new PlaybackSession(
        PERFORMANCE_ID,
        'track',
        [frame([partial(0), partial(1)])],
        0,
        false,
        settings()
      )

      session.start(100, audience.read, noLog)
      playChunks(1)

      expect(soprano.received[1]).toEqual({
        startTime: 102,
        waveform: 'sine',
        ttsRate: 1,
        chunk: { partials: [partial(0)] }
      })
      expect(alto.received[1].chunk).toEqual({ partials: [partial(1)] })
    })

    it('sends nothing to a device the chunk holds neither a partial nor a phrase for', () => {
      const singing = listener('singing', { choirId: 0 })
      const silent = listener('silent', { choirId: 7 })
      const audience = audienceOf([singing, silent])
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', [frame([partial(0)])], 0, false, settings())

      session.start(100, audience.read, noLog)
      playChunks(1)

      expect(singing.received).toHaveLength(2)
      expect(silent.received).toEqual([{ start: true }])
    })

    it('sends a phrase in the language the device asked for', () => {
      const german = listener('german', { choirId: 0, ttsLang: { iso: 'de-DE', lang: 'German' } })
      const audience = audienceOf([german])
      const frames = [frame([], { 0: { time: 0.5, langs: { 'de-DE': 'Guten Tag', 'en-US': 'Good day' } } })]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, false, settings())

      session.start(100, audience.read, noLog)
      playChunks(1)

      expect(german.received[1].chunk).toEqual({ ttsInstructions: { time: 0.5, phrase: 'Guten Tag' } })
    })
  })

  describe('in nonChoir mode', () => {
    it('spreads the frame’s partials across the devices', () => {
      const one = listener('one')
      const two = listener('two')
      const audience = audienceOf([one, two])
      const frames = [frame([partial(0), partial(1)])]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, false, settings({ mode: 'nonChoir' }))

      session.start(100, audience.read, noLog)
      playChunks(1)

      const allocated = [one, two].flatMap((device) => device.received[1]?.chunk.partials ?? [])
      expect(allocated).toHaveLength(2)
      expect(allocated.map((p: PartialChunk) => p.index).sort()).toEqual([0, 1])
    })

    it('reads the devices again each chunk, so one that joins late is served', () => {
      const early = listener('early')
      const late = listener('late')
      const audience = audienceOf([early])
      const frames = [frame([partial(0)]), frame([partial(0)])]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, false, settings({ mode: 'nonChoir' }))

      session.start(100, audience.read, noLog)
      playChunks(1)
      audience.roster.devices = [early, late]
      playChunks(1)

      // It missed the announcement and the first chunk, but not the second.
      expect(late.received).toHaveLength(1)
      expect(late.received[0].chunk.partials).toHaveLength(1)
    })

    // Choir mode leaves the key out entirely in this case. The two modes really
    // do put different shapes on the wire, and released apps parse both.
    it('still carries an empty partials list when a chunk holds only a phrase', () => {
      const device = listener('device')
      const audience = audienceOf([device])
      const frames = [frame([], { 0: { time: 0.5, langs: { 'en-US': 'hello' } } })]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, false, settings({ mode: 'nonChoir' }))

      session.start(100, audience.read, noLog)
      playChunks(1)

      expect(device.received[1].chunk).toEqual({ partials: [], ttsInstructions: { time: 0.5, phrase: 'hello' } })
    })
  })

  describe('over the length of a track', () => {
    it('begins at the stored start position, scheduled so that chunk plays on time', () => {
      const device = listener('device', { choirId: 0 })
      const audience = audienceOf([device])
      const frames = [frame([partial(0)]), frame([partial(0)]), frame([partial(0)])]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 2, false, settings())

      session.start(100, audience.read, noLog)
      playChunks(1)

      // Chunk 2 is sent first, and dated as if the run had begun two chunks ago.
      expect(device.received[1].startTime).toBe(100 - 2 + 2)
    })

    it('tells every device it stopped when the frames run out', () => {
      const playing = listener('playing', { choirId: 0 })
      const silent = listener('silent', { choirId: 7 })
      const audience = audienceOf([playing, silent])
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', [frame([partial(0)])], 0, false, settings())

      session.start(100, audience.read, noLog)
      playChunks(2)

      expect(playing.received.at(-1)).toEqual({ stop: true })
      expect(silent.received.at(-1)).toEqual({ stop: true })
      expect(session.isRunning()).toBe(false)
    })

    it('keeps scheduling into the future when it loops', () => {
      const device = listener('device', { choirId: 0 })
      const audience = audienceOf([device])
      const frames = [frame([partial(0)]), frame([partial(0)])]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, true, settings())

      session.start(100, audience.read, noLog)
      playChunks(3)

      const startTimes = device.received.slice(1).map((message) => message.startTime)
      // The third chunk is the first of the repeat, a whole track length later.
      expect(startTimes).toEqual([102, 102, 104])
    })

    it('stops sending once it has been stopped', () => {
      const device = listener('device', { choirId: 0 })
      const audience = audienceOf([device])
      const frames = [frame([partial(0)]), frame([partial(0)]), frame([partial(0)])]
      const session = new PlaybackSession(PERFORMANCE_ID, 'track', frames, 0, false, settings())

      session.start(100, audience.read, noLog)
      playChunks(1)
      session.stop()
      playChunks(5)

      expect(device.received.at(-1)).toEqual({ stop: true })
      expect(device.received.filter((message) => 'chunk' in message)).toHaveLength(1)
    })
  })
})
