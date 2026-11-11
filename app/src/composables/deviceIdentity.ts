import { App } from '@capacitor/app'
import { Device } from '@capacitor/device'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { DeviceIdentity } from './protocol'

/**
 * Who this phone is, as it tells the server in its handshake. Only the
 * performance log reads it, so nothing here may keep a phone from connecting:
 * whatever cannot be found out is left empty, each part on its own.
 */

const DEVICE_ID_KEY = 'deviceId'

/** How long a plugin may take to answer before what it would say is taken as unknown. */
const ANSWER_WITHIN_MS = 2000

/** What `promise` gives, or `fallback` when it has not answered within `ANSWER_WITHIN_MS`. */
const withinMoment = <T>(promise: Promise<T>, fallback: T) =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ANSWER_WITHIN_MS)
    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })

/** What the id is kept in. */
type IdStore = Pick<typeof Preferences, 'get' | 'set'>

/**
 * A random version 4 UUID. `crypto.randomUUID` arrived in iOS 15.4 and in
 * Android System WebView 92; older phones make one from random bytes.
 */
const randomId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The id of this installation of the app: made up on first use, then kept. When
 * it cannot be kept, it still serves for as long as the app runs.
 */
export const loadDeviceId = async (preferences: IdStore = Preferences) => {
  const stored = await preferences.get({ key: DEVICE_ID_KEY }).then(
    ({ value }) => value,
    () => null
  )
  if (stored) return stored

  const id = randomId()
  await preferences
    .set({ key: DEVICE_ID_KEY, value: id })
    .catch((err: unknown) => console.warn('Could not keep the device id:', err))
  return id
}

/** The app build, or empty where the platform cannot say, as in a browser. */
const appBuild = () =>
  withinMoment(
    App.getInfo().then(
      ({ build }) => build,
      () => ''
    ),
    ''
  )

const UNKNOWN_DEVICE = { platform: '', osVersion: '', model: '' }

/** The platform, system and model, empty where the device cannot say. */
const deviceInfo = () =>
  withinMoment(
    Device.getInfo().then(
      ({ platform, osVersion, model }) => ({ platform, osVersion, model }),
      (err: unknown) => {
        console.warn('Could not find out what device this is:', err)
        return UNKNOWN_DEVICE
      }
    ),
    UNKNOWN_DEVICE
  )

/** How the phone reaches the network now, kept up to date as that changes. */
const watchNetworkType = async () => {
  let type = 'unknown'
  const keep = ({ connectionType }: { connectionType: string }) => {
    type = connectionType
  }
  await withinMoment(
    Network.getStatus().then(keep, () => undefined),
    undefined
  )
  void Network.addListener('networkStatusChange', keep).catch(() => undefined)
  return () => type
}

/**
 * Finds out who this phone is, once. The result gives the identity for a
 * handshake, with the network type of the moment it is called, so each
 * connection says how it was made. What cannot be found out is left empty.
 */
export const loadDeviceIdentity = async (): Promise<() => DeviceIdentity> => {
  const [id, info, build, networkType] = await Promise.all([
    withinMoment(loadDeviceId(), randomId()),
    deviceInfo(),
    appBuild(),
    watchNetworkType()
  ])
  return () => ({
    id,
    appVersion: import.meta.env.VITE_APP_VERSION,
    appBuild: build,
    ...info,
    network: networkType()
  })
}
