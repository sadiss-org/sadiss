import { registerPlugin } from '@capacitor/core'
import type { PlaybackServicePlugin } from './definitions'

/** Android only: on other platforms every call rejects as unimplemented. */
const PlaybackService = registerPlugin<PlaybackServicePlugin>('PlaybackService')

export * from './definitions'
export { PlaybackService }
