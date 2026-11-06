import { createPinia, setActivePinia } from 'pinia'
import { useBarcodeScanner } from '@/composables/useBarcodeScanner'

const { speak, isLanguageSupported } = vi.hoisted(() => ({
  speak: vi.fn().mockResolvedValue(undefined),
  isLanguageSupported: vi.fn()
}))
vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak, isLanguageSupported } }))

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
    isLanguageSupported.mockReset().mockResolvedValue({ supported: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const scanAndSpeak = async (
    tts: { iso: string; lang: string }[] | undefined,
    pick?: { iso: string; lang: string },
    phrases = 1
  ) => {
    const { usePlayer } = await import('@/composables/usePlayer')
    const { useMainStore } = await import('@/stores/MainStore')
    const player = usePlayer()
    player.setMotionRef({ pos: 0 })

    useBarcodeScanner().processScanResult({ performanceName: 'Abend', performanceId: 'p1', wsUrl: 'ws://wsUrl.test', tts })
    if (pick) useMainStore().selectedLanguage = pick
    await player.preparePlaybackAndTts()

    player.setStartTime(0)
    for (let i = 0; i < phrases; i++) {
      player.handleChunkData({ partials: [], ttsInstructions: { time: 0, phrase: 'Guten Abend.' } })
      await vi.advanceTimersByTimeAsync(200)
    }
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

  it("is the phone's default voice when the phone has no voice for the language, so the phrase is still heard", async () => {
    isLanguageSupported.mockResolvedValue({ supported: false })
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }])
    expect(phraseLanguages()).toEqual([undefined])
  })

  it('is the language itself when checking for a voice fails, so a broken check does not change the voice', async () => {
    isLanguageSupported.mockRejectedValue(new Error('not implemented'))
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }])
    expect(phraseLanguages()).toEqual(['de-DE'])
  })

  it('is checked for a voice once per language, not before every phrase', async () => {
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }], undefined, 3)
    expect(phraseLanguages()).toEqual(['de-DE', 'de-DE', 'de-DE'])
    expect(isLanguageSupported).toHaveBeenCalledTimes(1)
  })

  it('is asked for again after a no, so an engine that was still starting does not keep the default voice', async () => {
    isLanguageSupported.mockResolvedValueOnce({ supported: false }).mockResolvedValue({ supported: true })
    await scanAndSpeak([{ iso: 'de-DE', lang: 'Deutsch' }], undefined, 2)
    expect(phraseLanguages()).toEqual([undefined, 'de-DE'])
  })

  it('is not checked for a voice when the QR code offers no language', async () => {
    await scanAndSpeak(undefined)
    expect(isLanguageSupported).not.toHaveBeenCalled()
  })
})
