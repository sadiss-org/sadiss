import { useMainStore } from '@/stores/MainStore'
import { ref } from 'vue'
import { usePlayer } from './usePlayer'
import { useClockMeasurement } from './useClockMeasurement'
import { buildClientInfoMessage } from './protocol'
import { Capacitor } from '@capacitor/core'
import { createResilientSocket } from './resilientSocket'
import { iosSpeechRate } from './iosSpeechRate'

const { handleChunkData, setOffset, stopPlayback, setStartTime, setTrackSettings } = usePlayer()
const measurement = useClockMeasurement()

/**
 * Clock-sync replies a connection may miss before it is given up on. Between
 * them a connected device hears nothing unless a track is playing.
 */
const REPLIES_MISSED_BEFORE_GIVING_UP = 3

/** The cadence assumed until the server has said, which is also how long a new connection has to answer. */
const ASSUMED_MEASURE_INTERVAL_MS = 3000

/** Whether the server is being heard from. */
const isRegistered = ref(false)
let connecting = false

export function useWebsocketConnection() {
  const mainStore = useMainStore()

  /** Joins the performance and stays joined for as long as the app runs. Later calls do nothing. */
  const establishWebsocketConnection = async () => {
    if (connecting) return
    connecting = true
    while (!mainStore.wsUrl) {
      console.log('waiting for ws url')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    console.log('ws url: ', mainStore.wsUrl)

    createResilientSocket({
      url: mainStore.wsUrl,
      onOpen: (send) => {
        measurement.start((message) => send(JSON.stringify(message)))
        send(
          JSON.stringify(
            buildClientInfoMessage({
              clientId: mainStore.choirId,
              ttsLang: mainStore.selectedLanguage,
              performanceId: mainStore.performanceId
            })
          )
        )
      },
      onMessage: handleMessage,
      // Playback is left alone when the connection goes: what is already
      // scheduled plays out while the next one is found.
      onLiveChange: (live) => (isRegistered.value = live),
      silenceLimitMs: () => REPLIES_MISSED_BEFORE_GIVING_UP * (measurement.intervalMs() || ASSUMED_MEASURE_INTERVAL_MS)
    })
  }

  return { establishWebsocketConnection, isRegistered }
}

const handleMessage = (raw: string) => {
  if (!raw) {
    return
  }

  console.log(raw)

  let data
  try {
    data = JSON.parse(raw)
    console.log(data)
  } catch {
    // Data is not JSON, ignore it
    return
  }

  // Clock-sync measurement messages are handled separately and must not fall
  // through to playback processing.
  if (measurement.handleMessage(data)) {
    return
  }

  if (data.start) {
    setOffset()
  }

  if (data.stop) {
    stopPlayback()
    return
  }

  // We need to set globalStartTime every time we receive data and not just at the start of the track because clients can join late.
  setStartTime(data.startTime)

  // TODO: This can be moved into usePlayer.ts, doesn't need to happen here.
  let ttsRate = data.ttsRate

  if (Capacitor.getPlatform() === 'ios') {
    ttsRate = iosSpeechRate(ttsRate)
  }

  setTrackSettings(data.waveform, ttsRate)

  // TODO: This can be moved into usePlayer.ts, doesn't need to happen here.
  if (data.chunk && Object.keys(data.chunk).length) {
    handleChunkData(data.chunk)
  }
}
