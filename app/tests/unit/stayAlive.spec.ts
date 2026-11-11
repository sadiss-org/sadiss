import type { Mock } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { PlaybackService } from '@sadiss/playback-service'
import { stayAlive } from '@/composables/stayAlive'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: vi.fn() }
}))

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: { keepAwake: vi.fn() }
}))

vi.mock('@sadiss/playback-service', () => ({
  PlaybackService: { start: vi.fn() }
}))

const getPlatform = Capacitor.getPlatform as Mock
const keepAwake = KeepAwake.keepAwake as Mock
const startService = PlaybackService.start as Mock

describe('stayAlive', () => {
  beforeEach(() => {
    getPlatform.mockReset()
    keepAwake.mockReset().mockResolvedValue(undefined)
    startService.mockReset().mockResolvedValue(undefined)
  })

  it('keeps an Android screen awake and starts the playback service', async () => {
    getPlatform.mockReturnValue('android')

    await stayAlive()

    expect(keepAwake).toHaveBeenCalledTimes(1)
    expect(startService).toHaveBeenCalledTimes(1)
  })

  it('only keeps the screen awake on iOS', async () => {
    getPlatform.mockReturnValue('ios')

    await stayAlive()

    expect(keepAwake).toHaveBeenCalledTimes(1)
    expect(startService).not.toHaveBeenCalled()
  })

  it('does nothing in a browser', async () => {
    getPlatform.mockReturnValue('web')

    await stayAlive()

    expect(keepAwake).not.toHaveBeenCalled()
    expect(startService).not.toHaveBeenCalled()
  })

  // Android refuses a foreground service start in some states; joining must go on.
  it('resolves and still keeps the screen awake when the service cannot start', async () => {
    getPlatform.mockReturnValue('android')
    startService.mockRejectedValue(new Error('startForegroundService() not allowed'))

    await expect(stayAlive()).resolves.toBeUndefined()

    expect(keepAwake).toHaveBeenCalledTimes(1)
  })

  it('still starts the service when the screen cannot be kept awake', async () => {
    getPlatform.mockReturnValue('android')
    keepAwake.mockRejectedValue(new Error('no window'))

    await expect(stayAlive()).resolves.toBeUndefined()

    expect(startService).toHaveBeenCalledTimes(1)
  })
})
