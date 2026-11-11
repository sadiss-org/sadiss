import { loadDeviceId } from '@/composables/deviceIdentity'

/** Preferences kept in memory, the way the phone keeps them across launches. */
const memoryPreferences = () => {
  const stored = new Map<string, string>()
  return {
    get: async ({ key }: { key: string }) => ({ value: stored.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      stored.set(key, value)
    }
  }
}

describe('the device id', () => {
  it('is the same on every connection of one installation', async () => {
    const preferences = memoryPreferences()

    const first = await loadDeviceId(preferences)
    const second = await loadDeviceId(preferences)

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toBe(first)
  })

  it('survives the app being started again', async () => {
    const preferences = memoryPreferences()
    const before = await loadDeviceId(preferences)

    vi.resetModules()
    const { loadDeviceId: loadAfterRestart } = await import('@/composables/deviceIdentity')

    expect(await loadAfterRestart(preferences)).toBe(before)
  })

  it('differs between two installations', async () => {
    expect(await loadDeviceId(memoryPreferences())).not.toBe(await loadDeviceId(memoryPreferences()))
  })
})

describe('the device id on a phone that lacks crypto.randomUUID, such as iOS before 15.4', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is still made up, in the same shape', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    const preferences = memoryPreferences()

    const id = await loadDeviceId(preferences)

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await loadDeviceId(preferences)).toBe(id)
  })
})

describe('the identity when part of it cannot be found out', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('@capacitor/device')
    vi.doUnmock('@capacitor/preferences')
    vi.doUnmock('@capacitor/network')
    vi.doUnmock('@capacitor/app')
  })

  const mockPlugins = (overrides: { device?: () => Promise<unknown>; save?: () => Promise<void> } = {}) => {
    vi.doMock('@capacitor/preferences', () => ({
      Preferences: { get: async () => ({ value: null }), set: overrides.save ?? (async () => undefined) }
    }))
    vi.doMock('@capacitor/device', () => ({
      Device: { getInfo: overrides.device ?? (async () => ({ platform: 'ios', osVersion: '15.0', model: 'iPhone10,4' })) }
    }))
    vi.doMock('@capacitor/app', () => ({ App: { getInfo: async () => ({ build: '12' }) } }))
    vi.doMock('@capacitor/network', () => ({
      Network: {
        getStatus: async () => ({ connected: true, connectionType: 'cellular' }),
        addListener: async () => ({ remove: async () => undefined })
      }
    }))
  }

  it('keeps the id and leaves the rest empty when the device cannot say what it is', async () => {
    mockPlugins({ device: () => Promise.reject(new Error('not implemented')) })
    const { loadDeviceIdentity } = await import('@/composables/deviceIdentity')

    const identity = (await loadDeviceIdentity())()

    expect(identity).toMatchObject({ platform: '', osVersion: '', model: '', appBuild: '12', network: 'cellular' })
    expect(identity.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps the id for this run when it cannot be saved', async () => {
    mockPlugins({ save: () => Promise.reject(new Error('storage full')) })
    const { loadDeviceIdentity } = await import('@/composables/deviceIdentity')

    const identify = await loadDeviceIdentity()

    expect(identify().id).toMatch(/^[0-9a-f-]{36}$/)
    expect(identify().id).toBe(identify().id)
  })

  it('says how the phone reached the network in its first handshake', async () => {
    mockPlugins()
    const { loadDeviceIdentity } = await import('@/composables/deviceIdentity')

    expect((await loadDeviceIdentity())().network).toBe('cellular')
  })

  it('does not wait more than a moment for a part that never answers, so the phone still connects', async () => {
    vi.useFakeTimers()
    mockPlugins({ device: () => new Promise(() => undefined) })
    const { loadDeviceIdentity } = await import('@/composables/deviceIdentity')

    const loading = loadDeviceIdentity()
    await vi.advanceTimersByTimeAsync(2000)

    expect((await loading)()).toMatchObject({ platform: '', model: '', network: 'cellular' })
    vi.useRealTimers()
  })
})
