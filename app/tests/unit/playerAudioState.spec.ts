import { usePlayer } from '@/composables/usePlayer'

vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak: vi.fn() } }))

/** What the player tells the phone report about its audio and the screen. */
describe("the player's state for the phone report", () => {
  beforeEach(() => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has no audio to describe before playback was prepared, and says whether the app is in the foreground', () => {
    expect(usePlayer().deviceState()).toEqual({ audio: null, keepAlivePlaying: null, visible: true })
  })

  it('describes the audio context once there is one, with null for what it cannot say', () => {
    class FakeAudioContext {
      state = 'running'
      currentTime = 2
      sampleRate = 48000
      baseLatency = 0.005
      onstatechange: (() => void) | null = null
      // outputLatency and getOutputTimestamp are missing, as in older WebKit.
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
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
    player.setOutputLatencyOffset(0.12)

    void player.preparePlaybackAndTts()

    expect(player.deviceState()).toEqual({
      audio: {
        scheduleOffsetS: 998,
        calibrationS: 0.12,
        state: 'running',
        outputLatency: null,
        baseLatency: 0.005,
        sampleRate: 48000,
        outputTimestamp: null
      },
      keepAlivePlaying: true,
      visible: true
    })
  })
})
