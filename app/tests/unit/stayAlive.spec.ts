import type { Mock } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { PlaybackService } from '@sadiss/playback-service'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: vi.fn() }
}))

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: { keepAwake: vi.fn() }
}))

vi.mock('@sadiss/playback-service', () => ({
  PlaybackService: { start: vi.fn(), stop: vi.fn() }
}))

const getPlatform = Capacitor.getPlatform as Mock
const keepAwake = KeepAwake.keepAwake as Mock
const startService = PlaybackService.start as Mock

/** A fresh copy of the module, as on a new app run. */
const freshStayAlive = async () => {
  vi.resetModules()
  const { stayAlive } = await import('@/composables/stayAlive')
  return stayAlive
}

describe('stayAlive', () => {
  beforeEach(() => {
    getPlatform.mockReset()
    keepAwake.mockReset().mockResolvedValue(undefined)
    startService.mockReset().mockResolvedValue(undefined)
  })

  it('keeps an Android screen awake and starts the playback service', async () => {
    getPlatform.mockReturnValue('android')
    const stayAlive = await freshStayAlive()

    await stayAlive()

    expect(keepAwake).toHaveBeenCalledTimes(1)
    expect(startService).toHaveBeenCalledTimes(1)
  })

  it('does nothing more when called a second time', async () => {
    getPlatform.mockReturnValue('android')
    const stayAlive = await freshStayAlive()

    await stayAlive()
    await stayAlive()

    expect(keepAwake).toHaveBeenCalledTimes(1)
    expect(startService).toHaveBeenCalledTimes(1)
  })

  it('only keeps the screen awake on iOS', async () => {
    getPlatform.mockReturnValue('ios')
    const stayAlive = await freshStayAlive()

    await stayAlive()

    expect(keepAwake).toHaveBeenCalledTimes(1)
    expect(startService).not.toHaveBeenCalled()
  })

  it('does nothing in a browser', async () => {
    getPlatform.mockReturnValue('web')
    const stayAlive = await freshStayAlive()

    await stayAlive()

    expect(keepAwake).not.toHaveBeenCalled()
    expect(startService).not.toHaveBeenCalled()
  })

  // Android refuses a foreground service start in some states; joining must go on.
  it('resolves and still keeps the screen awake when the service cannot start', async () => {
    getPlatform.mockReturnValue('android')
    startService.mockRejectedValue(new Error('startForegroundService() not allowed'))
    const stayAlive = await freshStayAlive()

    await expect(stayAlive()).resolves.toBeUndefined()

    expect(keepAwake).toHaveBeenCalledTimes(1)
  })

  it('still starts the service when the screen cannot be kept awake', async () => {
    getPlatform.mockReturnValue('android')
    keepAwake.mockRejectedValue(new Error('no window'))
    const stayAlive = await freshStayAlive()

    await expect(stayAlive()).resolves.toBeUndefined()

    expect(startService).toHaveBeenCalledTimes(1)
  })
})
