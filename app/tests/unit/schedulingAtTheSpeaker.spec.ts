import { usePlayer } from '@/composables/usePlayer'

vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak: vi.fn() } }))

/** Server time minus the phone's page clock, in seconds, in every case below. */
const CLOCK_OFFSET_S = 5000
const PAGE_NOW_MS = 100_000

/** What the audio context reports, as one phone's browser gives it. */
interface FakeContextReading {
  currentTime: number
  outputLatency?: number
  stamp?: { contextTime: number; performanceTime: number }
}

let context: FakeContextReading & { state: string; onstatechange: (() => void) | null }

/**
 * Prepares playback on a phone whose audio context reads as given, and returns
 * the player. Its schedule offset is server time minus the audio time a sound
 * must be scheduled at to be heard at that server time.
 */
const preparedPlayer = (reading: FakeContextReading) => {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        context = { ...reading, state: 'running', onstatechange: null }
        if (reading.stamp) {
          Object.assign(this, { getOutputTimestamp: () => context.stamp })
        }
        Object.assign(this, { close: () => Promise.resolve() })
        return new Proxy(this, {
          get: (target, key) => (key in context ? context[key as keyof typeof context] : Reflect.get(target, key)),
          set: (_, key, value) => Reflect.set(context, key, value)
        })
      }
    }
  )
  vi.stubGlobal(
    'Audio',
    class {
      loop = false
      paused = false
      play = () => Promise.resolve()
    }
  )
  vi.spyOn(performance, 'now').mockReturnValue(PAGE_NOW_MS)
  const player = usePlayer()
  player.setMotionRef({
    get pos() {
      return performance.now() / 1000 + CLOCK_OFFSET_S
    }
  })
  player.setOutputLatencyOffset(0)
  void player.preparePlaybackAndTts()
  return player
}

const scheduleOffset = (player: ReturnType<typeof usePlayer>) => player.deviceState().audio?.scheduleOffsetS

/** Server time minus audio time at the render position, which the player used to schedule against. */
const renderOffset = (currentTime: number) => PAGE_NOW_MS / 1000 + CLOCK_OFFSET_S - currentTime

describe('a phone schedules its sound for when it leaves the speaker', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('takes the moment of output from the output timestamp when it trails the render position, as on Android', () => {
    // The stamped sample left the speaker 10 ms ago and is 141 ms of audio behind
    // the render position: the output runs 131 ms behind what is rendered.
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.088,
      stamp: { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS - 10 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.131, 6)
  })

  it('keeps the same offset when the audio clock steps between two chunks', () => {
    const stamp = { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS - 10 }
    const player = preparedPlayer({ currentTime: 50, outputLatency: 0.088, stamp })
    const before = scheduleOffset(player)

    context.currentTime = 50.02
    player.setOffset()

    expect(scheduleOffset(player)).toBeCloseTo(before ?? Number.NaN, 6)
  })

  it('adds the reported output latency when the output timestamp is at the render position, as on iOS', () => {
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.0126,
      stamp: { contextTime: 50 - 0.01, performanceTime: PAGE_NOW_MS - 10 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.0126, 6)
  })

  it('adds the reported output latency to the render position when the phone gives no output timestamp', () => {
    const player = preparedPlayer({ currentTime: 50, outputLatency: 0.02 })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.02, 6)
  })

  it('does not trust an output timestamp that is far from the audio clock, as on iOS 16', () => {
    // Measured on an iPhone SE with iOS 16.6.1: the stamp's audio time stays near
    // zero while the context has been running for minutes.
    const player = preparedPlayer({
      currentTime: 300,
      outputLatency: 0.02,
      stamp: { contextTime: 0.0067, performanceTime: PAGE_NOW_MS - 10 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(300) + 0.02, 6)
  })

  it('does not trust an output timestamp ahead of the render position', () => {
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.02,
      stamp: { contextTime: 50.5, performanceTime: PAGE_NOW_MS - 10 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.02, 6)
  })

  it('does not trust an output timestamp from the future, as on a Galaxy J5 with Android 9', () => {
    // Measured on a Galaxy J5: its stamps are about 230 ms ahead of the page
    // clock, and the offsets they give wander by half a second within one run.
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.088,
      stamp: { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS + 230 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.088, 6)
  })

  it('stops trusting output timestamps once one came from the future, so the offset does not switch between the two', () => {
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.088,
      stamp: { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS + 230 }
    })

    context.stamp = { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS - 10 }
    player.setOffset()

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.088, 6)
  })

  it('trusts an output timestamp a few ms ahead of the page clock, as a healthy phone gives', () => {
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.088,
      stamp: { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS + 5 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.141 + 0.005, 6)
  })

  it('trusts an output timestamp up to 50 ms ahead of the page clock, and not one further ahead', () => {
    const at = (aheadMs: number) =>
      scheduleOffset(
        preparedPlayer({
          currentTime: 50,
          outputLatency: 0.088,
          stamp: { contextTime: 50 - 0.141, performanceTime: PAGE_NOW_MS + aheadMs }
        })
      )

    expect(at(45)).toBeCloseTo(renderOffset(50) + 0.141 + 0.045, 6)
    expect(at(55)).toBeCloseTo(renderOffset(50) + 0.088, 6)
  })

  it('does not take a pause right after the output timestamp was read for a stamp from the future', () => {
    // The phone stalls for 80 ms while the stamp is read. The stamp itself is
    // 15 ms old, measured from when it was taken.
    let nowMs = PAGE_NOW_MS
    const player = preparedPlayer({ currentTime: 50, outputLatency: 0.088 })
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    Object.defineProperty(context, 'stamp', {
      get: () => {
        nowMs += 80
        return { contextTime: 50 - 0.141, performanceTime: nowMs - 15 }
      }
    })
    Object.assign(context, { getOutputTimestamp: () => context.stamp })

    player.setOffset()

    const serverNowS = nowMs / 1000 + CLOCK_OFFSET_S
    expect(scheduleOffset(player)).toBeCloseTo(serverNowS - 0.015 - (50 - 0.141), 6)
  })

  it('does not trust an output timestamp from before the first sound left the speaker', () => {
    const player = preparedPlayer({
      currentTime: 50,
      outputLatency: 0.02,
      stamp: { contextTime: 0, performanceTime: 0 }
    })

    expect(scheduleOffset(player)).toBeCloseTo(renderOffset(50) + 0.02, 6)
  })
})
