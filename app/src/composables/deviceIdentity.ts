import { App } from '@capacitor/app'
import { Device } from '@capacitor/device'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { DeviceIdentity } from './protocol'

/**
 * Who this phone is, as it tells the server in its handshake. Only the
 * performance log reads it, so nothing here may keep a phone from connecting:
 * whatever cannot be found out is left empty.
 */

const DEVICE_ID_KEY = 'deviceId'

/** What the id is kept in. */
type IdStore = Pick<typeof Preferences, 'get' | 'set'>

/** The id of this installation of the app: made up on first use, then kept. */
export const loadDeviceId = async (preferences: IdStore = Preferences) => {
  const { value } = await preferences.get({ key: DEVICE_ID_KEY })
  if (value) return value

  const id = crypto.randomUUID()
  await preferences.set({ key: DEVICE_ID_KEY, value: id })
  return id
}

/** The app build, or empty where the platform cannot say, as in a browser. */
const appBuild = async () => {
  try {
    return (await App.getInfo()).build
  } catch {
    return ''
  }
}

/** How the phone reaches the network now, kept up to date as that changes. */
const watchNetworkType = () => {
  let type = 'unknown'
  const keep = ({ connectionType }: { connectionType: string }) => {
    type = connectionType
  }
  void Network.getStatus()
    .then(keep)
    .catch(() => undefined)
  void Network.addListener('networkStatusChange', keep).catch(() => undefined)
  return () => type
}

/**
 * Finds out who this phone is, once. The result gives the identity for a
 * handshake, with the network type of the moment it is called, so each
 * connection says how it was made. Undefined when the phone cannot say.
 */
export const loadDeviceIdentity = async (): Promise<(() => DeviceIdentity) | undefined> => {
  try {
    const [id, info, build] = await Promise.all([loadDeviceId(), Device.getInfo(), appBuild()])
    const networkType = watchNetworkType()
    return () => ({
      id,
      appVersion: import.meta.env.VITE_APP_VERSION,
      appBuild: build,
      platform: info.platform,
      osVersion: info.osVersion,
      model: info.model,
      network: networkType()
    })
  } catch (err) {
    console.warn('Could not find out who this phone is:', err)
    return undefined
  }
}
