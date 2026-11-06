import { createPinia, setActivePinia } from 'pinia'
import { useBarcodeScanner } from '@/composables/useBarcodeScanner'

const { speak } = vi.hoisted(() => ({ speak: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak } }))

class FakeAudioContext {
  currentTime = 1000
  state = 'running'
  onstatechange: (() => void) | null = null
}

class FakeAudio {
  loop = false
  play = () => Promise.resolve()
}

const phraseLanguages = () =>
  speak.mock.calls.map(([options]) => options).filter((options) => options.text === 'Guten Abend.').map((options) => options.lang)

describe('the language a TTS phrase is spoken in', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('Audio', FakeAudio)
    setActivePinia(createPinia())
    speak.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const scanAndSpeak = async (tts: { iso: string; lang: string }[] | undefined, pick?: { iso: string; lang: string }) => {
    const { usePlayer } = await import('@/composables/usePlayer')
    const { useMainStore } = await import('@/stores/MainStore')
    const player = usePlayer()
    player.setMotionRef({ pos: 0 })

    useBarcodeScanner().processScanResult({ performanceName: 'Abend', performanceId: 'p1', wsUrl: 'ws://wsUrl.test', tts })
    if (pick) useMainStore().selectedLanguage = pick
    await player.preparePlaybackAndTts()

    player.setStartTime(0)
    player.handleChunkData({ partials: [], ttsInstructions: { time: 0, phrase: 'Guten Abend.' } })
    await vi.advanceTimersByTimeAsync(200)
  }

  it('is the only language of a QR code that offers one', async () => {
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }])
    expect(phraseLanguages()).toEqual(['de-DE'])
  })

  it('is the language picked on the language page when the QR code offers several', async () => {
    const english = { iso: 'en-GB', lang: 'English' }
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }, english], english)
    expect(phraseLanguages()).toEqual(['en-GB'])
  })

  it("is left to the plugin's default when the QR code offers no language", async () => {
    await scanAndSpeak(undefined)
    expect(phraseLanguages()).toEqual([undefined])
  })
})
