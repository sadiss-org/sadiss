vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak: vi.fn() } }))

/** An audio context whose clock moves only when the test says so, as on a phone whose audio stopped. */
class FakeAudioContext {
  static made: FakeAudioContext[] = []
  /** Whether the next context to be made fails, as `new AudioContext()` can. */
  static failNext = false
  state = 'running'
  currentTime = 1.6
  sampleRate = 48000
  baseLatency = 0.003
  destination = {}
  closed = false
  oscillatorsMade = 0
  oscillatorsStopped = 0
  onstatechange: (() => void) | null = null
  constructor() {
    if (FakeAudioContext.failNext) {
      FakeAudioContext.failNext = false
      throw new Error('NotSupportedError')
    }
    FakeAudioContext.made.push(this)
  }
  close = () => {
    this.closed = true
    return Promise.resolve()
  }
  createOscillator = () => {
    this.oscillatorsMade++
    const param = { value: 0, exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() }
    return {
      frequency: param,
      type: 'sine',
      connect: vi.fn(),
      start: vi.fn(),
      stop: () => {
        this.oscillatorsStopped++
      }
    }
  }
  createGain = () => ({ gain: { value: 0, exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() }, connect: vi.fn() })
}

const chunk = { partials: [{ index: 0, startTime: 0, endTime: 1, breakpoints: [{ time: 0, freq: 440, amp: 0.5 }] }] }

/**
 * Prepares playback the way joining does, on a fresh copy of the player, since
 * the audio and its watch last as long as the app does. Returns the player.
 */
const preparedPlayer = async () => {
  vi.resetModules()
  const { usePlayer } = await import('@/composables/usePlayer')
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal(
    'Audio',
    class {
      loop = false
      paused = false
      play = () => Promise.resolve()
    }
  )
  const player = usePlayer()
  player.setMotionRef({ pos: 1000 })
  void player.preparePlaybackAndTts()
  return player
}

const latestContext = () => FakeAudioContext.made[FakeAudioContext.made.length - 1]

/** A phone's audio can stop while it still says it is running; the player then builds it again. */
describe('an audio clock that stopped', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is closed and replaced by a new audio context, which the report counts', async () => {
    const player = await preparedPlayer()
    const stalled = latestContext()

    vi.advanceTimersByTime(3000)

    expect(stalled.closed).toBe(true)
    expect(latestContext()).not.toBe(stalled)
    expect(player.deviceState().audio?.restarts).toBe(1)
  })

  it('is built again once when the phone joined twice', async () => {
    const player = await preparedPlayer()
    void player.preparePlaybackAndTts()

    vi.advanceTimersByTime(3000)

    expect(player.deviceState().audio?.restarts).toBe(1)
  })

  it('is kept, and replaced at the next try, when a new audio context cannot be made', async () => {
    const player = await preparedPlayer()
    const stalled = latestContext()
    FakeAudioContext.failNext = true

    vi.advanceTimersByTime(3000)

    expect(stalled.closed).toBe(false)
    expect(player.deviceState().audio?.restarts).toBe(0)

    vi.advanceTimersByTime(3000)

    expect(stalled.closed).toBe(true)
    expect(latestContext()).not.toBe(stalled)
    expect(player.deviceState().audio?.restarts).toBe(1)
  })

  it('is left alone while it moves', async () => {
    const player = await preparedPlayer()
    const moving = latestContext()

    for (let second = 0; second < 10; second++) {
      moving.currentTime += 1
      vi.advanceTimersByTime(1000)
    }

    expect(moving.closed).toBe(false)
    expect(player.deviceState().audio?.restarts).toBe(0)
  })

  it('is left alone while the context says it is not running, which the context handles itself', async () => {
    await preparedPlayer()
    const suspended = latestContext()
    suspended.state = 'suspended'

    vi.advanceTimersByTime(10_000)

    expect(suspended.closed).toBe(false)
  })

  it('plays the next chunk on the new context, not on the one that stopped', async () => {
    const player = await preparedPlayer()
    player.handleChunkData(chunk)
    const stalled = latestContext()

    vi.advanceTimersByTime(3000)
    latestContext().currentTime = 5
    player.handleChunkData(chunk)

    expect(latestContext()).not.toBe(stalled)
    expect(stalled.oscillatorsMade).toBe(1)
    expect(latestContext().oscillatorsMade).toBe(1)
  })
})

/** iOS limits how many audio contexts a page holds, so a phone that joins again must not keep the old one. */
describe('joining again', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('closes the audio context of the earlier join', async () => {
    const player = await preparedPlayer()
    const earlier = latestContext()

    void player.preparePlaybackAndTts()

    expect(earlier.closed).toBe(true)
    expect(FakeAudioContext.made.filter((context) => !context.closed)).toHaveLength(1)
  })

  it('plays the next chunk on the new context', async () => {
    const player = await preparedPlayer()
    const earlier = latestContext()

    void player.preparePlaybackAndTts()
    player.handleChunkData(chunk)

    expect(earlier.oscillatorsMade).toBe(0)
    expect(latestContext().oscillatorsMade).toBe(1)
  })

  it('is not counted as a restart of a stopped audio clock', async () => {
    const player = await preparedPlayer()

    void player.preparePlaybackAndTts()

    expect(player.deviceState().audio?.restarts).toBe(0)
  })
})

describe('stopping playback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stops every sounding oscillator', async () => {
    const player = await preparedPlayer()
    const breakpoints = [{ time: 0, freq: 440, amp: 0.5 }]
    player.handleChunkData({
      partials: [0, 1, 2, 3].map((index) => ({ index, startTime: 0, endTime: 1, breakpoints }))
    })

    player.stopPlayback()

    expect(latestContext().oscillatorsStopped).toBe(4)
  })
})
