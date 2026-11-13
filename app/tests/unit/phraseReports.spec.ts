import { createPinia, setActivePinia } from 'pinia'
import { useBarcodeScanner } from '@/composables/useBarcodeScanner'

const { speak, isLanguageSupported } = vi.hoisted(() => ({
  speak: vi.fn(),
  isLanguageSupported: vi.fn()
}))
vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak, isLanguageSupported } }))

class FakeAudioContext {
  static current: FakeAudioContext
  currentTime = 1000
  state = 'running'
  onstatechange: (() => void) | null = null
  constructor() {
    FakeAudioContext.current = this
  }
}

class FakeAudio {
  loop = false
  play = () => Promise.resolve()
}

const PHRASE = 'Guten Abend.'

/** Joins a performance whose QR code offers German, and returns the player. */
const joined = async () => {
  const { usePlayer } = await import('@/composables/usePlayer')
  const player = usePlayer()
  player.setMotionRef({ pos: 0 })
  useBarcodeScanner().processScanResult({
    performanceName: 'Abend',
    performanceId: 'p1',
    wsUrl: 'ws://wsUrl.test',
    tts: [{ iso: 'de-DE', lang: 'Deutsch' }]
  })
  await player.preparePlaybackAndTts()
  player.setTrackSettings('sine', '1.2')
  // Server time 0 is audio time 1000 here, so a phrase at track time t is due at audio time 1000 + t.
  player.setStartTime(0)
  speak.mockClear()
  return player
}

/** Sends a phrase due at `time` in the track and lets the audio clock reach it. */
const phraseAt = async (player: Awaited<ReturnType<typeof joined>>, time: number) => {
  player.handleChunkData({ partials: [], ttsInstructions: { time, phrase: PHRASE } })
  FakeAudioContext.current.currentTime = 1000 + time
  await vi.advanceTimersByTimeAsync(100)
}

describe('the report of a TTS phrase', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('Audio', FakeAudio)
    setActivePinia(createPinia())
    speak.mockReset().mockResolvedValue(undefined)
    isLanguageSupported.mockReset().mockResolvedValue({ supported: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('says when the phrase was due, in which language and rate, and that it was spoken', async () => {
    const player = await joined()

    await phraseAt(player, 4)

    expect(player.takePhraseReports()).toEqual([
      { trackTimeS: 4, lang: 'de-DE', rate: 1.2, askedLateMs: expect.any(Number), tookMs: expect.any(Number), error: null }
    ])
  })

  it('says how long after it was due speaking was asked for', async () => {
    const player = await joined()
    player.handleChunkData({ partials: [], ttsInstructions: { time: 4, phrase: PHRASE } })

    // The audio clock is 0.25 s past the phrase when the player next looks.
    FakeAudioContext.current.currentTime = 1004.25
    await vi.advanceTimersByTimeAsync(100)

    expect(player.takePhraseReports()[0].askedLateMs).toBeCloseTo(250)
  })

  it('says how long the engine took to speak it', async () => {
    const player = await joined()
    speak.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1500)))

    await phraseAt(player, 4)
    await vi.advanceTimersByTimeAsync(1500)

    expect(player.takePhraseReports()[0].tookMs).toBe(1500)
  })

  it('says why the engine did not speak it, without an unhandled rejection', async () => {
    const player = await joined()
    speak.mockRejectedValue(new Error('This language is not supported.'))

    await phraseAt(player, 4)

    expect(player.takePhraseReports()).toMatchObject([{ trackTimeS: 4, error: 'This language is not supported.' }])
  })

  it("names no language when the phrase was left to the engine's default voice", async () => {
    isLanguageSupported.mockResolvedValue({ supported: false })
    const player = await joined()

    await phraseAt(player, 4)

    expect(player.takePhraseReports()).toMatchObject([{ lang: null }])
  })

  it('is handed over once, so the next report holds only later phrases', async () => {
    const player = await joined()
    await phraseAt(player, 4)
    player.takePhraseReports()

    await phraseAt(player, 8)

    expect(player.takePhraseReports().map((phrase) => phrase.trackTimeS)).toEqual([8])
  })

  it('keeps only the newest 20 while no report goes out, as when the server asks for none', async () => {
    const player = await joined()

    for (let time = 1; time <= 25; time++) await phraseAt(player, time)

    const kept = player.takePhraseReports().map((phrase) => phrase.trackTimeS)
    expect(kept).toHaveLength(20)
    expect(kept[0]).toBe(6)
    expect(kept[19]).toBe(25)
  })
})
