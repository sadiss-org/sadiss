import { useMainStore } from '@/stores/MainStore'
import { ref } from 'vue'
import { usePlayer } from './usePlayer'
import { useClockMeasurement } from './useClockMeasurement'
import { Capacitor } from '@capacitor/core'
import { connectDevice } from './deviceConnection'
import { iosSpeechRate } from './iosSpeechRate'
import { loadDeviceIdentity } from './deviceIdentity'
import { stayAlive } from './stayAlive'

const { handleChunkData, setOffset, stopPlayback, setStartTime, setTrackSettings, deviceState } = usePlayer()
const measurement = useClockMeasurement()

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
    const identity = await loadDeviceIdentity()

    connectDevice({
      url: mainStore.wsUrl,
      clientInfo: () => ({
        clientId: mainStore.choirId,
        ttsLang: mainStore.selectedLanguage,
        performanceId: mainStore.performanceId,
        device: identity()
      }),
      clockSync: measurement,
      deviceState,
      onPlayback: handlePlayback,
      log: (raw) => console.log(raw),
      // Playback is left alone when the connection goes: what is already
      // scheduled plays out while the next one is found.
      onLiveChange: (live) => (isRegistered.value = live)
    })
    await stayAlive()
  }

  return { establishWebsocketConnection, isRegistered }
}

const handlePlayback = (data: Record<string, any>) => {
  console.log(data)

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
