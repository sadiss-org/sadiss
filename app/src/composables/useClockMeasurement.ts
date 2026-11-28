import { usePlayer } from './usePlayer'
import { createClockSync } from './clockSync'

const { setMotionRef } = usePlayer()

/**
 * The app's clock sync, handed to the player as the shared clock it schedules
 * against through `setMotionRef`. Pings immediately when returning to the
 * foreground so a phone waking from OS sleep re-locks without waiting for the
 * next interval tick.
 */
export function useClockMeasurement() {
  const sync = createClockSync()
  setMotionRef({
    get pos() {
      return sync.clock.posAt(performance.now())
    }
  })
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync.pingNow()
    })
  }
  return sync
}
