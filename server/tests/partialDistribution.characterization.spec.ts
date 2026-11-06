/**
 * CHARACTERIZATION tests for the partial-distribution logic in
 * `PlaybackSession.start` (handleChoirDistribution /
 * handleNonChoirDistribution + getClientIdWithMinPartials).
 *
 * These are "golden master" tests in the Fowler sense: they pin down the
 * CURRENT observable behaviour of the distribution — which client receives
 * which partial indices, per frame — so the tangled implementation can be
 * refactored with confidence. They assert what the code does today, INCLUDING
 * quirks (e.g. the MAX cap dropping a partial, the disconnect-reassignment
 * path). If a refactor is meant to preserve behaviour, these must stay green.
 * If a test here looks "wrong", that is a documented quirk, not a spec.
 *
 * How it works: the distribution runs inside a setInterval-driven `step()`.
 * We register mock ws clients (send = vi.fn()), build a session for a set of
 * frames, start it, and advance fake timers one second per frame. Then we read
 * back the JSON payloads each client's `send` received.
 */
import { Types } from 'mongoose'
import { createMockWsClient } from './testUtils'
import { PlaybackSession } from '../playbackSession'
import { webSocketAudience } from '../lib/audience'
import { Frame, PartialChunk, TrackMode, TtsInstructions } from '../types'

type MockClient = ReturnType<typeof createMockWsClient>

// --- fixtures -------------------------------------------------------------

const partial = (index: number): PartialChunk => ({
  index,
  startTime: 0,
  endTime: 1,
  breakpoints: [{ time: 0, freq: 440 + index, amp: 1 }]
})

const frame = (partialIndices: number[], ttsInstructions: TtsInstructions = {} as TtsInstructions): Frame => ({
  partials: partialIndices.map(partial),
  ttsInstructions
})

// --- driving the interval -------------------------------------------------

const testWss = () => (global as any).testWss

/** The session's listeners, read off the shared mock client set as the server does. */
const audienceFor = (run: Run) => webSocketAudience(testWss(), String(run.performanceId))

/**
 * Starts the sending interval and advances fake time one frame (1s) at a time.
 * `betweenFrames(i)` runs immediately after frame `i` has been distributed,
 * which is how we simulate a client (dis)connecting mid-performance.
 */
const drive = (run: Run, frameCount: number, betweenFrames?: (frameIndex: number) => void) => {
  run.session!.start(Date.now() / 1000, audienceFor(run))
  for (let i = 0; i < frameCount; i++) {
    vi.advanceTimersByTime(1000)
    betweenFrames?.(i)
  }
  run.session!.stop()
  vi.advanceTimersByTime(1000) // let the stop propagate (sends {stop:true})
}

// --- reading what a client received ---------------------------------------

interface ReceivedChunk {
  partials?: PartialChunk[]
  ttsInstructions?: { time: number; phrase: string }
}

/** Parsed `chunk` payloads a client received, in order (control frames dropped). */
const chunksReceivedBy = (client: MockClient): ReceivedChunk[] =>
  client.send.mock.calls
    .map((call: any[]) => JSON.parse(call[0]))
    .filter((msg: any) => msg && typeof msg === 'object' && 'chunk' in msg)
    .map((msg: any) => msg.chunk)

/** For each chunk a client received, the sorted list of partial indices in it. */
const partialIndicesPerFrame = (client: MockClient): number[][] =>
  chunksReceivedBy(client).map((chunk) => (chunk.partials ?? []).map((p) => p.index).sort((a, b) => a - b))

/** Flattened set of every partial index a client ever received. */
const allPartialIndices = (client: MockClient): number[] => partialIndicesPerFrame(client).flat()

/** A performance plus the session built for it, so tests can keep using one handle. */
interface Run {
  performanceId: Types.ObjectId
  session?: PlaybackSession
}

const newPerformance = (): { performanceId: Types.ObjectId; run: Run } => {
  const performanceId = new Types.ObjectId()
  return { performanceId, run: { performanceId } }
}

const load = (run: Run, frames: Frame[], mode: TrackMode) => {
  run.session = new PlaybackSession(run.performanceId, 'track-id', frames, 0, false, {
    mode,
    waveform: 'sine',
    ttsRate: 1
  })
}

const loadNonChoir = (run: Run, frames: Frame[]) => load(run, frames, 'nonChoir')
const loadChoir = (run: Run, frames: Frame[]) => load(run, frames, 'choir')

// -------------------------------------------------------------------------

describe('partial distribution (characterization)', () => {
  beforeEach(() => {
    // Mock clients live in the shared, module-level wss client set. Isolate
    // each test so leftover mocks from a previous test don't get distributed to.
    testWss().clients.clear()
  })

  afterEach(() => {
    // Also silences the 5s server heartbeat that logs on non-real ws clients.
    testWss().clients.clear()
  })

  describe('nonChoir mode', () => {
    it('gives every partial to the sole client when under the per-client cap', () => {
      const { performanceId, run } = newPerformance()
      const client = createMockWsClient(performanceId, 0)
      loadNonChoir(run, [frame([0, 1, 2])])

      drive(run, 1)

      expect(partialIndicesPerFrame(client)).toEqual([[0, 1, 2]])
    })

    it('balances partials across clients (fewest-partials-first)', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      loadNonChoir(run, [frame([0, 1])])

      drive(run, 1)

      // First partial goes to the first client with none; second partial then
      // goes to the other (now empty) client.
      expect(partialIndicesPerFrame(a)).toEqual([[0]])
      expect(partialIndicesPerFrame(b)).toEqual([[1]])
    })

    it('gives an otherwise-empty client the least-distributed partial (nobody gets nothing)', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      loadNonChoir(run, [frame([0])]) // one partial, two clients

      drive(run, 1)

      // A gets the only partial by allocation; B has none, so the
      // clients-without-partials pass hands it the least-distributed partial (0).
      expect(partialIndicesPerFrame(a)).toEqual([[0]])
      expect(partialIndicesPerFrame(b)).toEqual([[0]])
    })

    it('caps a single client at MAX_PARTIALS_PER_CLIENT (16) and DROPS the overflow', () => {
      const { performanceId, run } = newPerformance()
      const client = createMockWsClient(performanceId, 0)
      const seventeen = Array.from({ length: 17 }, (_, i) => i) // indices 0..16
      loadNonChoir(run, [frame(seventeen)])

      drive(run, 1)

      const received = allPartialIndices(client)
      // Quirk being pinned: the 17th partial is not distributed anywhere; it is
      // silently dropped (distributePartialToNewClient returns false -> break).
      expect(received).toHaveLength(16)
      expect(received).toEqual(Array.from({ length: 16 }, (_, i) => i)) // 0..15
      expect(received).not.toContain(16)
    })

    it('is sticky: a partial stays with the same client across frames', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      loadNonChoir(run, [frame([0, 1]), frame([0, 1])])

      drive(run, 2)

      // Frame 1 splits 0->A, 1->B; frame 2 re-uses last iteration's mapping.
      expect(partialIndicesPerFrame(a)).toEqual([[0], [0]])
      expect(partialIndicesPerFrame(b)).toEqual([[1], [1]])
    })

    it('reassigns a partial when the client that held it disconnects mid-performance', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      loadNonChoir(run, [frame([0, 1]), frame([0, 1])])

      drive(run, 2, (frameIndex) => {
        if (frameIndex === 0) testWss().clients.delete(b) // B leaves after frame 1
      })

      // Frame 1: 0->A, 1->B. Frame 2: B gone, so its partial (1) falls back to A.
      expect(partialIndicesPerFrame(a)).toEqual([[0], [0, 1]])
      // B only ever received frame 1.
      expect(partialIndicesPerFrame(b)).toEqual([[1]])
    })

    it('sends nothing to a client when there are no partials and no tts', () => {
      const { performanceId, run } = newPerformance()
      const client = createMockWsClient(performanceId, 0)
      loadNonChoir(run, [frame([])])

      drive(run, 1)

      expect(chunksReceivedBy(client)).toEqual([])
    })

    it('broadcasts the first tts instruction to every client (nonChoir tts is not per-voice)', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      const tts: TtsInstructions = {
        0: { time: 0.5, langs: { 'en-US': 'hello' } }
      }
      loadNonChoir(run, [frame([], tts)])

      drive(run, 1)

      const ttsFor = (c: MockClient) => chunksReceivedBy(c).map((chunk) => chunk.ttsInstructions)
      expect(ttsFor(a)).toEqual([{ time: 0.5, phrase: 'hello' }])
      expect(ttsFor(b)).toEqual([{ time: 0.5, phrase: 'hello' }])
    })
  })

  describe('choir mode', () => {
    it('gives each client only the partial whose index matches its choirId', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0) // choirId 0
      const b = createMockWsClient(performanceId, 1) // choirId 1
      loadChoir(run, [frame([0, 1, 2])])

      drive(run, 1)

      expect(partialIndicesPerFrame(a)).toEqual([[0]])
      expect(partialIndicesPerFrame(b)).toEqual([[1]])
    })

    it('sends nothing to a client whose choirId matches no partial', () => {
      const { performanceId, run } = newPerformance()
      const orphan = createMockWsClient(performanceId, 9) // no partial index 9
      loadChoir(run, [frame([0, 1, 2])])

      drive(run, 1)

      expect(chunksReceivedBy(orphan)).toEqual([])
    })

    it('routes tts to a client by choirId and in the client language', () => {
      const { performanceId, run } = newPerformance()
      const a = createMockWsClient(performanceId, 0)
      const b = createMockWsClient(performanceId, 1)
      const tts: TtsInstructions = {
        0: { time: 0.25, langs: { 'en-US': 'for-zero' } },
        1: { time: 0.75, langs: { 'en-US': 'for-one' } }
      }
      loadChoir(run, [frame([], tts)])

      drive(run, 1)

      expect(chunksReceivedBy(a).map((c) => c.ttsInstructions)).toEqual([{ time: 0.25, phrase: 'for-zero' }])
      expect(chunksReceivedBy(b).map((c) => c.ttsInstructions)).toEqual([{ time: 0.75, phrase: 'for-one' }])
    })
  })

  describe('interval guard', () => {
    it('does not start a second concurrent interval while one is running', () => {
      const { performanceId, run } = newPerformance()
      createMockWsClient(performanceId, 0)
      loadNonChoir(run, [frame([0]), frame([0]), frame([0])])

      const first = run.session!.start(Date.now() / 1000, audienceFor(run))
      const second = run.session!.start(Date.now() / 1000, audienceFor(run))

      expect(first).toBe(true)
      expect(second).toBe(false)

      run.session!.stop()
      vi.advanceTimersByTime(2000)
    })
  })
})
