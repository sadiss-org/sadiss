import { usePlayer } from './usePlayer'
import { createClockSync } from './clockSync'

const { setMotionRef } = usePlayer()

/**
 * The app's clock sync, handed to the player as the shared clock it schedules
 * against through `setMotionRef`.
 */
export function useClockMeasurement() {
  const sync = createClockSync()
  setMotionRef({
    get pos() {
      return sync.clock.posAt(performance.now())
    }
  })
  return sync
}
