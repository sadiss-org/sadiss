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
