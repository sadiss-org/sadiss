import { setTimeout as sleep } from 'node:timers/promises'
import { CHUNK_SECONDS } from '@server/types/ChunkEnvelope'
import { createAudience, joinGradually } from './audience'
import { Options } from './options'
import { RunResult, watch } from './results'
import { createTarget } from './target'

/** How long after the last chunk is due it may still be on its way. */
const TAIL_MS = 4000

/**
 * One run with a fixed number of phones: the phones join, measure their clocks,
 * hear the whole track and leave.
 */
export const runFixed = async (options: Options, admin: { email: string; password: string }): Promise<RunResult> => {
  const target = await createTarget(options.apiUrl, admin.email, admin.password)
  const performance = await target.prepare(options.track, `loadtest ${new Date().toISOString()}`)

  const audience = createAudience()
  let watching: ReturnType<typeof watch> | undefined
  try {
    await joinGradually(audience, options.phones, options.joinOverMs, () => ({
      wsUrl: options.wsUrl,
      performanceId: performance.id,
      choirId: 0,
      ttsLang: { iso: 'en-US', lang: 'English' }
    }))
    await sleep(options.settleMs)
    if (audience.phones.every((phone) => phone.connects === 0)) {
      throw new Error(`No phone could connect to ${options.wsUrl}.`)
    }

    watching = watch(audience)
    await performance.start()
    await sleep(performance.chunkCount * CHUNK_SECONDS * 1000 + TAIL_MS)
    await performance.stop()
    const result = watching.finish(options.track, performance.chunkCount)
    watching = undefined
    return result
  } finally {
    watching?.stop()
    audience.leave()
  }
}
