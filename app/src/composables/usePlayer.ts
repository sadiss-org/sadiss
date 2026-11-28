import { reactive, ref } from 'vue'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { PartialChunk, OscillatorObject, Breakpoint } from '../types/types'
import { useMainStore } from '@/stores/MainStore'
import type { DeviceState } from './deviceConnection'
import type { PhraseReport } from '@/types/measurement'
import { createStampReader, speakerOffset } from './speakerOffset'

const BREAKPOINT_LENGTH = 0.01 // in seconds
const AMP_MIN_VALUE = 0.000001
const FREQ_MIN_VALUE = 0.000001

/** How often the audio clock is checked for having stopped, in ms. */
const CLOCK_CHECK_MS = 1000
/**
 * Checks in a row the audio clock may stand still while its context says it is
 * running before the audio is built again. A running clock moves between any two.
 */
const CHECKS_STANDING_STILL_BEFORE_RESTART = 3

let ctx: AudioContext
/** The sounding oscillators, all on the current audio context. */
const oscillators: OscillatorObject[] = []
/** How often the audio was built again because its clock had stopped. */
let restarts = 0
let clockWatch: ReturnType<typeof setInterval> | undefined
let visibilityListening = false
/** True when automatic audio recovery could not restart playback and a tap is needed. */
const audioNeedsResume = ref(false)
let lastClockTime = 0
let checksStandingStill = 0
let checksSuspended = 0
let recoveryStep = 0
let suspendedRetries = 0
/** The current audio context's output timestamps, as the schedule offset uses them. */
let readStamp: ReturnType<typeof createStampReader>
let offset: number
let motion: { pos: number } = reactive({ pos: -1 })
let outputLatencyOffset = 0
let waveform: OscillatorType
let ttsRate = 1
let keepAlive: HTMLAudioElement | undefined

/**
 * Phrases kept for the next report. While the server asks for no reports none
 * go out, so only the newest are kept.
 */
const MAX_PHRASE_REPORTS = 20
const phraseReports: PhraseReport[] = []
const keepPhraseReport = (report: PhraseReport) => {
  phraseReports.push(report)
  if (phraseReports.length > MAX_PHRASE_REPORTS) phraseReports.splice(0, phraseReports.length - MAX_PHRASE_REPORTS)
}

/**
 * Languages the phone was found to have a voice for. Only a yes is kept: on
 * Android the check also answers no while the speech engine is still starting.
 */
const languagesWithVoice = new Set<string>()

/**
 * The language to speak a phrase in: the one the QR code offered, or undefined
 * for the plugin's own default voice (en-US). A phone without a voice for the
 * offered language gets the default voice too, because a phrase read with the
 * wrong accent is better than one that is not heard at all. If the check itself
 * fails, the offered language is used, as it would be without the check.
 */
const voiceLanguage = async (): Promise<string | undefined> => {
  const iso = useMainStore().selectedLanguage.iso
  if (!iso) return undefined
  if (languagesWithVoice.has(iso)) return iso

  const supported = await TextToSpeech.isLanguageSupported({ lang: iso }).then(
    (result) => result.supported,
    () => true
  )
  if (!supported) return undefined
  languagesWithVoice.add(iso)
  return iso
}

/**
 * One second of 8 kHz mono 16-bit silence as a WAV blob URL.
 */
const silentWavUrl = () => {
  const sampleRate = 8000
  const dataBytes = sampleRate * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }))
}

/**
 * Tells WebKit this page plays media and loops silence through a media element,
 * so iOS counts the app as playing media for as long as it runs, including the
 * gaps between chunks. Safe to call again after background suspension: resumes
 * the silent element whenever iOS paused it.
 *
 * The lock screen's play and pause buttons act on this element; they do
 * nothing, because the server decides when a performance plays.
 */
const ensureAudioSession = () => {
  const { audioSession } = navigator as Navigator & { audioSession?: { type: string } }
  if (audioSession) audioSession.type = 'playback'

  if (!keepAlive) {
    keepAlive = new Audio(silentWavUrl())
    keepAlive.loop = true
    keepAlive.play().catch((error) => console.warn('Silent keep-alive did not start:', error))

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {})
      navigator.mediaSession.setActionHandler('pause', () => {})
    }
    return
  }

  if (keepAlive.paused) {
    keepAlive.play().catch((error) => console.warn('Silent keep-alive did not start:', error))
  }
}

const resetAudioWatch = () => {
  lastClockTime = ctx ? ctx.currentTime : 0
  checksStandingStill = 0
  checksSuspended = 0
  recoveryStep = 0
  suspendedRetries = 0
  audioNeedsResume.value = false
}

const resumeCtx = (context: AudioContext) => {
  if (typeof context.resume !== 'function') return
  void context.resume().catch((error) => console.warn('Audio context did not resume:', error))
}

/** Cycles a stalled running context through suspend and resume before tearing it down. */
const cycleAudioCtx = () => {
  const current = ctx
  if (!current || typeof current.suspend !== 'function' || typeof current.resume !== 'function') return
  void current
    .suspend()
    .then(() => {
      if (ctx === current) return current.resume()
    })
    .catch((error) => console.warn('Audio context could not be resumed:', error))
}

/** A figure the platform may not give, such as `outputLatency` in older WebKit. */
const finiteOrNull = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The audio clock against the page clock at the moment of output, where the platform has it. */
const outputTimestamp = (context: AudioContext) => {
  if (typeof context.getOutputTimestamp !== 'function') return null
  const { contextTime, performanceTime } = context.getOutputTimestamp()
  return { contextTime: finiteOrNull(contextTime), performanceTime: finiteOrNull(performanceTime) }
}

export function usePlayer() {
  const currentChunkStartTimeInCtxTime = ref()

  /**
   * Prepares the audio context and warms up the TTS engine
   */
  const preparePlaybackAndTts = async () => {
    startAudioCtx()
    await warmUpTtsEngine()
  }

  const startAudioCtx = () => {
    ensureAudioSession()
    // Each join replaces the context of the one before: iOS limits how many a
    // page holds, so one left running per join would end in silence.
    if (ctx) replaceAudioCtx()
    else createAudioCtx()
    resetAudioWatch()
    watchAudioClock()
  }

  const createAudioCtx = () => {
    const context = new AudioContext()
    ctx = context
    readStamp = createStampReader(
      () => outputTimestamp(context),
      () => performance.now()
    )

    ctx.onstatechange = () => {
      // Resume ctx when going to sleep/background/etc preventing issue where iOS wouldn't restart playback
      // Taken from https://github.com/Tonejs/Tone.js/issues/995#issuecomment-1005082160
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        resumeCtx(ctx)
      }

      // When coming back from sleep/background/etc prevent playback of already past notes
      if (ctx.state === 'running') {
        stopPlayback()
      }
    }

    setOffset()
  }

  const watchVisibility = () => {
    if (visibilityListening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
    visibilityListening = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !ctx) return
      ensureAudioSession()
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        resumeCtx(ctx)
      }
    })
  }

  /**
   * Watches for audio that stopped rendering after backgrounding or an OS
   * interruption. For a stalled running clock it first re-asserts the audio
   * session and cycles suspend/resume, then replaces the context once, and
   * finally stops restarting and asks for a user tap instead of tearing down
   * the context every few seconds. For a context stuck suspended while the app
   * is visible it retries resume once before asking for a tap.
   */
  const watchAudioClock = () => {
    watchVisibility()
    if (clockWatch) return
    lastClockTime = ctx.currentTime
    clockWatch = setInterval(() => {
      if (!ctx) return

      if (ctx.state === 'running' && ctx.currentTime !== lastClockTime) {
        resetAudioWatch()
        return
      }

      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        checksStandingStill = 0
        if (document.visibilityState !== 'visible' || audioNeedsResume.value) {
          checksSuspended = 0
          return
        }
        checksSuspended++
        if (checksSuspended < CHECKS_STANDING_STILL_BEFORE_RESTART) return
        checksSuspended = 0
        if (suspendedRetries === 0) {
          suspendedRetries = 1
          ensureAudioSession()
          resumeCtx(ctx)
          return
        }
        audioNeedsResume.value = true
        return
      }

      if (ctx.state !== 'running' || audioNeedsResume.value) return

      checksSuspended = 0
      checksStandingStill++
      if (checksStandingStill < CHECKS_STANDING_STILL_BEFORE_RESTART) return
      checksStandingStill = 0

      if (recoveryStep === 0) {
        recoveryStep = 1
        ensureAudioSession()
        cycleAudioCtx()
        return
      }

      if (recoveryStep === 1) {
        ensureAudioSession()
        if (restartAudioCtx()) {
          recoveryStep = 2
          lastClockTime = ctx.currentTime
        }
        return
      }

      audioNeedsResume.value = true
    }, CLOCK_CHECK_MS)
  }

  /**
   * Replaces the audio context with a new one and closes the old one. The
   * oscillators of the old one go with it. When no new one can be made, the
   * old one stays and this returns false.
   */
  const replaceAudioCtx = (): boolean => {
    const old = ctx
    try {
      createAudioCtx()
    } catch (error) {
      console.warn('No new audio context could be made:', error)
      return false
    }
    // The handler acts on whichever context is current, so the old context's
    // closing would otherwise stop the sound starting on the new one.
    old.onstatechange = null
    old.close().catch((error) => console.warn('The old audio context did not close:', error))
    oscillators.length = 0
    return true
  }

  /**
   * Builds the audio again after its clock stood still. When no new context
   * can be made, the old one stays, so the watch tries again.
   */
  const restartAudioCtx = (): boolean => {
    if (!replaceAudioCtx()) return false
    restarts++
    console.warn('The audio clock stood still while running; the audio was built again.')
    return true
  }

  /**
   * Unlocks the audio session, keep-alive, and audio context inside a user
   * gesture after automatic recovery could not restart playback.
   */
  const resumeAudio = () => {
    if (!ctx) return
    ensureAudioSession()
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      resumeCtx(ctx)
    } else {
      restartAudioCtx()
      if (ctx.state !== 'running') resumeCtx(ctx)
    }
    resetAudioWatch()
  }

  /**
   * Warms up the TTS engine by speaking a phrase 3 times with volume set to 0
   */
  const warmUpTtsEngine = async () => {
    for (let i = 0; i < 3; i++) {
      await TextToSpeech.speak({
        text: 'Warming up TTS engine.',
        lang: 'en-US',
        rate: 1.0,
        pitch: 1.0,
        volume: 0.001,
        category: 'playback'
      })
    }
  }

  let startTimeInCtxTime: number

  const handleChunkData = async (trackData: { partials: PartialChunk[]; ttsInstructions?: { time: number; phrase: string } }) => {
    if (!fadeOutAndStopOscillatorsInterval) {
      startFadeOutAndStopOscillatorsInterval() // Currently we leave this running until app is closed
    }

    // Set offset again to allow for ctx time drift
    setOffset()

    console.log('\nHandling following chunk data: ', trackData)

    // TODO: Refactor this
    currentChunkStartTimeInCtxTime.value = startTimeInCtxTime
    // console.log('currentChunkStartTimeInCtxTime: ', currentChunkStartTimeInCtxTime.value)

    if (trackData.partials) {
      for (const partialChunk of trackData.partials) {
        const oscObj = oscillators.find((el) => el.index === partialChunk.index)
        if (oscObj) {
          setBreakpoints(oscObj.oscillator, oscObj.gain, partialChunk.breakpoints)
          const lastBreakpointEndTime = partialChunk.breakpoints[partialChunk.breakpoints.length - 1].time
          oscObj.endTime = lastBreakpointEndTime + BREAKPOINT_LENGTH
          const lastGain = partialChunk.breakpoints[partialChunk.breakpoints.length - 1].amp
          oscObj.lastGain = lastGain
        } else {
          if (!ctx) return
          const oscNode = ctx.createOscillator()
          const gainNode = ctx.createGain()
          oscNode.connect(gainNode)
          gainNode.connect(ctx.destination)

          oscNode.type = waveform

          // Set initial frequency to the first breakpoint's frequency
          oscNode.frequency.value = partialChunk.breakpoints[0].freq

          // Set initial gain to 0 and start osc immediately
          gainNode.gain.value = AMP_MIN_VALUE
          oscNode.start()

          setBreakpoints(oscNode, gainNode, partialChunk.breakpoints)

          const lastBreakpointEndTime = partialChunk.breakpoints[partialChunk.breakpoints.length - 1].time
          const lastGain = partialChunk.breakpoints[partialChunk.breakpoints.length - 1].amp
          oscillators.push({
            index: partialChunk.index,
            oscillator: oscNode,
            gain: gainNode,
            endTime: lastBreakpointEndTime + BREAKPOINT_LENGTH,
            lastGain
          })
        }
      }
    }

    if (trackData.ttsInstructions) {
      const tts = trackData.ttsInstructions
      const speakingInterval = setInterval(() => {
        const timeToSpeakAt = startTimeInCtxTime + tts.time + outputLatencyOffset
        if (ctx.currentTime >= timeToSpeakAt) {
          clearInterval(speakingInterval)
          void speak(tts.phrase, tts.time, timeToSpeakAt)
        }
      }, 100)
    }
  }

  const setBreakpoints = (oscNode: OscillatorNode, gainNode: GainNode, breakpoints: Breakpoint[]) => {
    for (const bp of breakpoints) {
      let freqToSet = bp.freq
      let ampToSet = bp.amp
      // Set values <= 0 to 0.000001 because exponentialRampToValueAtTime doesn't work with 0 (or values less than 0)
      if (freqToSet <= 0) {
        freqToSet = FREQ_MIN_VALUE
      }
      if (ampToSet <= 0) {
        ampToSet = AMP_MIN_VALUE
      }
      oscNode.frequency.exponentialRampToValueAtTime(
        freqToSet,
        currentChunkStartTimeInCtxTime.value + bp.time + outputLatencyOffset
      )
      gainNode.gain.exponentialRampToValueAtTime(ampToSet, currentChunkStartTimeInCtxTime.value + bp.time + outputLatencyOffset)
    }
  }

  let fadeOutAndStopOscillatorsInterval: NodeJS.Timeout | null = null
  const startFadeOutAndStopOscillatorsInterval = () => {
    fadeOutAndStopOscillatorsInterval = setInterval(() => {
      // A copy, because stopping an oscillator takes it out of the list.
      for (const oscObj of [...oscillators]) {
        const oscEndTimeReached = ctx.currentTime > startTimeInCtxTime + oscObj.endTime + outputLatencyOffset
        if (oscEndTimeReached) {
          fadeOutAndStopOscillator(oscObj)
        }
      }
    }, 100)
  }

  const fadeOutAndStopOscillator = (oscObj: OscillatorObject) => {
    oscObj.gain.gain.setValueAtTime(oscObj.lastGain, ctx.currentTime)
    oscObj.gain.gain.exponentialRampToValueAtTime(AMP_MIN_VALUE, ctx.currentTime + 0.3)
    oscObj.oscillator.stop(ctx.currentTime + 0.3)

    // Remove from array
    oscillators.splice(oscillators.indexOf(oscObj), 1)
  }

  const setStartTime = (startTime: number) => (startTimeInCtxTime = startTime - offset)

  const stopPlayback = () => {
    // A copy, because stopping an oscillator takes it out of the list.
    for (const oscObj of [...oscillators]) {
      fadeOutAndStopOscillator(oscObj)
    }
  }

  /**
   * Speaks a phrase and keeps how it went for the next report. A failure is
   * kept, not thrown: one phrase the engine cannot speak must not stop the rest.
   */
  const speak = async (text: string, trackTimeS: number, dueAtCtxS: number) => {
    const lang = await voiceLanguage()
    const rate = ttsRate
    const askedLateMs = (ctx.currentTime - dueAtCtxS) * 1000
    const askedAt = performance.now()
    let error: string | null = null
    try {
      await TextToSpeech.speak({ text, lang, rate, pitch: 1.0, volume: 1.0, category: 'playback' })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.warn('A TTS phrase was not spoken:', err)
    }
    keepPhraseReport({ trackTimeS, lang: lang ?? null, rate, askedLateMs, tookMs: performance.now() - askedAt, error })
  }

  /** The phrases finished since this was last called, oldest first, for the phone report. */
  const takePhraseReports = (): PhraseReport[] => phraseReports.splice(0)

  const setMotionRef = (motionRef: { pos: number }) => (motion = motionRef)

  const setOffset = () => {
    const { stamp, pageNowMs } = readStamp()
    offset = speakerOffset({
      serverNowS: motion.pos,
      pageNowMs,
      renderTimeS: ctx.currentTime,
      outputLatencyS: finiteOrNull(ctx.outputLatency),
      stamp
    })
  }

  const setTrackSettings = (wf: OscillatorType, rate: string) => {
    waveform = wf
    ttsRate = +rate
  }

  const setOutputLatencyOffset = (newOutputLatencyOffset: number) => (outputLatencyOffset = newOutputLatencyOffset)

  /** How playback is scheduled now and whether the app is in the foreground, for the phone report. */
  const deviceState = (): DeviceState => ({
    audio: ctx
      ? {
          scheduleOffsetS: finiteOrNull(offset),
          calibrationS: outputLatencyOffset,
          state: ctx.state,
          outputLatency: finiteOrNull(ctx.outputLatency),
          baseLatency: finiteOrNull(ctx.baseLatency),
          sampleRate: finiteOrNull(ctx.sampleRate),
          outputTimestamp: outputTimestamp(ctx),
          restarts
        }
      : null,
    keepAlivePlaying: keepAlive ? !keepAlive.paused : null,
    visible: document.visibilityState === 'visible'
  })

  return {
    audioNeedsResume,
    deviceState,
    takePhraseReports,
    handleChunkData,
    preparePlaybackAndTts,
    resumeAudio,
    setStartTime,
    setMotionRef,
    setTrackSettings,
    stopPlayback,
    setOffset,
    setOutputLatencyOffset
  }
}
