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
  suspendedCount = 0
  resumedCount = 0
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
  suspend = () => {
    this.suspendedCount++
    return Promise.resolve()
  }
  resume = () => {
    this.resumedCount++
    return Promise.resolve()
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

class FakeAudio {
  static made: FakeAudio[] = []
  loop = false
  paused = false
  playCalls = 0
  constructor() {
    FakeAudio.made.push(this)
  }
  play = () => {
    this.playCalls++
    this.paused = false
    return Promise.resolve()
  }
}

const chunk = { partials: [{ index: 0, startTime: 0, endTime: 1, breakpoints: [{ time: 0, freq: 440, amp: 0.5 }] }] }

let fakeDocument: {
  visibilityState: string
  listeners: Map<string, () => void>
  addEventListener: (event: string, cb: () => void) => void
}
let fakeAudioSession: { type: string }

/**
 * Prepares playback the way joining does, on a fresh copy of the player, since
 * the audio and its watch last as long as the app does. Returns the player.
 */
const preparedPlayer = async () => {
  vi.resetModules()
  const { usePlayer } = await import('@/composables/usePlayer')
  fakeDocument = {
    visibilityState: 'visible',
    listeners: new Map(),
    addEventListener(event: string, cb: () => void) {
      this.listeners.set(event, cb)
    }
  }
  fakeAudioSession = { type: 'auto' }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('navigator', {
    audioSession: fakeAudioSession,
    mediaSession: { setActionHandler: vi.fn() }
  })
  vi.stubGlobal('Audio', FakeAudio)
  const player = usePlayer()
  player.setMotionRef({ pos: 1000 })
  void player.preparePlaybackAndTts()
  return player
}

const latestContext = () => FakeAudioContext.made[FakeAudioContext.made.length - 1]
const keepAliveAudio = () => FakeAudio.made[0]

/** A phone's audio can stop while it still says it is running; the player recovers without an endless restart loop. */
describe('an audio clock that stopped', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
    FakeAudio.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('tries suspend and resume plus re-asserting the audio session and keep-alive before replacing the context', async () => {
    const player = await preparedPlayer()
    const stalled = latestContext()
    fakeAudioSession.type = 'auto'
    keepAliveAudio().paused = true
    const playsBefore = keepAliveAudio().playCalls

    vi.advanceTimersByTime(3000)
    await Promise.resolve()

    expect(stalled.closed).toBe(false)
    expect(stalled.suspendedCount).toBe(1)
    expect(stalled.resumedCount).toBe(1)
    expect(fakeAudioSession.type).toBe('playback')
    expect(keepAliveAudio().playCalls).toBe(playsBefore + 1)
    expect(player.deviceState().audio?.restarts).toBe(0)
    expect(player.audioNeedsResume.value).toBe(false)

    // If that unstuck the clock, the context is kept and never replaced.
    stalled.currentTime += 1
    vi.advanceTimersByTime(1000)
    expect(stalled.closed).toBe(false)
    expect(player.deviceState().audio?.restarts).toBe(0)
  })

  it('closes and replaces the audio context when suspend and resume did not move the clock', async () => {
    const player = await preparedPlayer()
    const stalled = latestContext()

    vi.advanceTimersByTime(6000)

    expect(stalled.closed).toBe(true)
    expect(latestContext()).not.toBe(stalled)
    expect(player.deviceState().audio?.restarts).toBe(1)
  })

  it('stops restarting and asks the user to resume when replacing the context still leaves the clock stuck', async () => {
    const player = await preparedPlayer()

    vi.advanceTimersByTime(9000)

    expect(player.deviceState().audio?.restarts).toBe(1)
    expect(player.audioNeedsResume.value).toBe(true)

    // Staying stuck for another minute does not enter a 3 s restart loop.
    const kept = latestContext()
    vi.advanceTimersByTime(60_000)

    expect(kept.closed).toBe(false)
    expect(player.deviceState().audio?.restarts).toBe(1)
    expect(player.audioNeedsResume.value).toBe(true)
  })

  it('clears the resume prompt automatically if the clock starts moving on its own', async () => {
    const player = await preparedPlayer()
    vi.advanceTimersByTime(9000)
    expect(player.audioNeedsResume.value).toBe(true)

    latestContext().currentTime += 1
    vi.advanceTimersByTime(1000)

    expect(player.audioNeedsResume.value).toBe(false)
  })

  it('is built again once when the phone joined twice', async () => {
    const player = await preparedPlayer()
    void player.preparePlaybackAndTts()

    vi.advanceTimersByTime(6000)

    expect(player.deviceState().audio?.restarts).toBe(1)
  })

  it('is kept, and replaced at the next try, when a new audio context cannot be made', async () => {
    const player = await preparedPlayer()
    const stalled = latestContext()
    FakeAudioContext.failNext = true

    vi.advanceTimersByTime(6000)

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

  it('plays the next chunk on the new context, not on the one that stopped', async () => {
    const player = await preparedPlayer()
    player.handleChunkData(chunk)
    const stalled = latestContext()

    vi.advanceTimersByTime(6000)
    latestContext().currentTime = 5
    player.handleChunkData(chunk)

    expect(latestContext()).not.toBe(stalled)
    expect(stalled.oscillatorsMade).toBe(1)
    expect(latestContext().oscillatorsMade).toBe(1)
  })
})

/** A context stuck in suspended or interrupted while the app is visible must retry and then ask the user to tap. */
describe('a suspended audio context', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
    FakeAudio.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is never closed while suspended, and retries resume then prompts when stuck in the foreground', async () => {
    const player = await preparedPlayer()
    const suspended = latestContext()
    suspended.state = 'suspended'

    vi.advanceTimersByTime(3000)
    expect(suspended.closed).toBe(false)
    expect(suspended.resumedCount).toBe(1)
    expect(player.audioNeedsResume.value).toBe(false)

    vi.advanceTimersByTime(3000)
    expect(suspended.closed).toBe(false)
    expect(player.audioNeedsResume.value).toBe(true)
  })

  it('does not prompt while the app is in the background', async () => {
    const player = await preparedPlayer()
    const suspended = latestContext()
    suspended.state = 'suspended'
    fakeDocument.visibilityState = 'hidden'

    vi.advanceTimersByTime(10_000)

    expect(suspended.closed).toBe(false)
    expect(suspended.resumedCount).toBe(0)
    expect(player.audioNeedsResume.value).toBe(false)
  })

  it('resumes keep-alive and a suspended context when returning to the foreground', async () => {
    await preparedPlayer()
    const ctx = latestContext()
    ctx.state = 'suspended'
    fakeAudioSession.type = 'auto'
    keepAliveAudio().paused = true
    const playsBefore = keepAliveAudio().playCalls

    fakeDocument.visibilityState = 'hidden'
    fakeDocument.listeners.get('visibilitychange')?.()
    expect(ctx.resumedCount).toBe(0)
    expect(keepAliveAudio().playCalls).toBe(playsBefore)

    fakeDocument.visibilityState = 'visible'
    fakeDocument.listeners.get('visibilitychange')?.()
    expect(fakeAudioSession.type).toBe('playback')
    expect(keepAliveAudio().playCalls).toBe(playsBefore + 1)
    expect(ctx.resumedCount).toBe(1)
  })
})

/** Tapping to resume unlocks audio inside a user gesture. */
describe('manual audio resume', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
    FakeAudio.made = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('replaces a stalled running context, restarts paused keep-alive, and clears the prompt', async () => {
    const player = await preparedPlayer()
    vi.advanceTimersByTime(9000)
    expect(player.audioNeedsResume.value).toBe(true)

    const stuck = latestContext()
    fakeAudioSession.type = 'auto'
    keepAliveAudio().paused = true
    const playsBefore = keepAliveAudio().playCalls

    player.resumeAudio()

    expect(fakeAudioSession.type).toBe('playback')
    expect(keepAliveAudio().playCalls).toBe(playsBefore + 1)
    expect(stuck.closed).toBe(true)
    expect(latestContext()).not.toBe(stuck)
    expect(player.audioNeedsResume.value).toBe(false)
  })

  it('resumes a suspended context without closing it and clears the prompt', async () => {
    const player = await preparedPlayer()
    const suspended = latestContext()
    suspended.state = 'suspended'
    vi.advanceTimersByTime(6000)
    expect(player.audioNeedsResume.value).toBe(true)

    const resumesBefore = suspended.resumedCount
    player.resumeAudio()

    expect(suspended.closed).toBe(false)
    expect(suspended.resumedCount).toBe(resumesBefore + 1)
    expect(player.audioNeedsResume.value).toBe(false)
  })
})

/** iOS limits how many audio contexts a page holds, so a phone that joins again must not keep the old one. */
describe('joining again', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = []
    FakeAudio.made = []
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
    FakeAudio.made = []
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
