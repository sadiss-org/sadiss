import { setTimeout as sleep } from 'node:timers/promises'
import { CHUNK_SECONDS } from '@server/types/ChunkEnvelope'
import { createAudience, joinGradually } from './audience'
import { Options } from './options'
import { RunResult, watch } from './results'
import { planRoom } from './room'
import { Sampled, SamplingTarget, serverFigures, startSampler } from './serverSampler'
import { createTarget, PreparedPerformance } from './target'

/** How long after the last chunk is due it may still be on its way. */
const TAIL_MS = 4000

/** How often the server under test is sampled. */
const SAMPLE_EVERY_S = 5

/** How much longer than the run is expected to take the sampler may run, before it stops on its own. */
const SAMPLER_SPARE_S = 120

/**
 * Stops the track once the measurement is over. What the phones received is
 * already settled by then, so a stop that fails, such as when the server died
 * during the track and stayed down, is a warning and the run is still judged.
 */
export const stopTrack = async (performance: Pick<PreparedPerformance, 'stop'>, warn: (message: string) => void) => {
  try {
    await performance.stop()
  } catch (error) {
    warn(`Stopping the track failed, so it may still be playing on the server: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Uploads the run's generated track into a new performance on the server under test. */
export const prepare = async (options: Options, admin: { email: string; password: string }) => {
  const target = await createTarget(options.apiUrl, admin.email, admin.password)
  return target.prepare(options.track, `loadtest ${new Date().toISOString()}`)
}

/**
 * One room of `phones` phones in a prepared performance: most phones join and
 * measure their clocks before the track, the rest join during its first half,
 * and all of them hear the track to its end and leave. The server is sampled
 * from the first phone joining until the track is stopped, where it can be.
 */
export const runRoom = async (
  performance: PreparedPerformance,
  phones: number,
  options: Options,
  warn: (message: string) => void,
  sampling: SamplingTarget
): Promise<{ result: RunResult; server: Sampled }> => {
  const expectedS = (options.joinOverMs + options.settleMs + performance.chunkCount * CHUNK_SECONDS * 1000 + TAIL_MS) / 1000
  const sampler =
    'notSampledBecause' in sampling ? null : startSampler(sampling, { everyS: SAMPLE_EVERY_S, forAtMostS: Math.ceil(expectedS) + SAMPLER_SPARE_S })
  const stopSampling = async (): Promise<Sampled> =>
    sampler ? sampler.stop() : { samples: [], notSampledBecause: 'notSampledBecause' in sampling ? sampling.notSampledBecause : null }

  const audience = createAudience()
  let watching: ReturnType<typeof watch> | undefined
  try {
    const seats = planRoom({ phones, track: options.track, lateShare: options.lateShare }).map((seat) => ({
      wsUrl: options.wsUrl,
      performanceId: performance.id,
      seat
    }))
    await joinGradually(audience, seats.filter(({ seat }) => !seat.late), options.joinOverMs)
    await sleep(options.settleMs)
    if (audience.phones.every((phone) => phone.connects === 0)) {
      throw new Error(`No phone could connect to ${options.wsUrl}.`)
    }

    watching = watch(audience)
    await performance.start()
    const trackMs = performance.chunkCount * CHUNK_SECONDS * 1000
    const lateJoining = joinGradually(audience, seats.filter(({ seat }) => seat.late), trackMs / 2)
    await sleep(trackMs + TAIL_MS)
    await lateJoining
    await stopTrack(performance, warn)
    const server = await stopSampling()
    const result = { ...watching.finish(options.track, performance.chunkCount), ...serverFigures(server.samples) }
    watching = undefined
    return { result, server }
  } finally {
    watching?.stop()
    audience.leave()
    await sampler?.stop()
  }
}
