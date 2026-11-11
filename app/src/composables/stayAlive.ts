import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { PlaybackService } from '@sadiss/playback-service'

let holding = false

/**
 * Keeps the phone running the app for as long as it is joined to a performance,
 * which is until the app closes. Later calls do nothing.
 *
 * The screen is held awake, not only while connected: a phone that locks while it
 * reconnects stops running the app, and with it the reconnect. On Android a
 * foreground service also keeps the app running when the user locks the screen
 * anyway; without it Android reclaims the app a few minutes later.
 *
 * A failure is logged and never stops the join.
 */
export async function stayAlive(): Promise<void> {
  if (holding) return
  holding = true

  const platform = Capacitor.getPlatform()
  if (platform === 'web') return

  try {
    await KeepAwake.keepAwake()
  } catch (error) {
    console.log(error)
  }

  if (platform === 'android') {
    try {
      await PlaybackService.start()
    } catch (error) {
      console.log(error)
    }
  }
}
