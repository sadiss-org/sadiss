import { monitorEventLoopDelay } from 'node:perf_hooks'
import { distancesFromMedian, summarize, Summary } from './stats'
import { TrackShape } from './track'
import { Audience } from './audience'

export interface RunResult {
  phones: number
  track: TrackShape
  chunkCount: number
  /** How long before its first sound each chunk arrived, over every phone and chunk, in ms. */
  arrivalLeadMs: Summary
  /** Chunks a phone received before it had any clock estimate. */
  arrivalsWithoutClock: number
  /** Chunks of the track a phone never received, counted per phone. */
  missingChunks: number
  /** Connections the phones opened, from joining to the end of the track. */
  connects: number
  /** Live connections the phones lost from the start of the track until it was stopped, including the tail in which late chunks may still arrive. */
  dropsDuringTrack: number
  /** Live connections the phones lost before the track started, while joining and settling. */
  dropsBeforeTrack: number
  /** Round trip of every clock measurement, from joining to the end of the track, in ms. */
  roundTripMs: Summary
  /** How many clock round trips each phone had completed when the track started. */
  roundTripsAtStart: Summary
  /** How far each phone's clock offset was from the median of all phones, sampled every second while the track played, in ms. */
  offsetFromMedianMs: Summary
  /** How far the load generator's own event loop fell behind, in ms. */
  generatorDelayMs: { p99: number; max: number }
}

const SAMPLE_EVERY_MS = 1000
const DELAY_RESOLUTION_MS = 10

/**
 * Watches an audience while a track plays: every second the clock offsets of
 * the phones in it at that moment, including phones that join later, and
 * throughout the load generator's own event loop.
 */
export const watch = (audience: Audience) => {
  const roundTripsAtStart = audience.phones.map((phone) => phone.roundTripsMs.length)
  // runFixed has every phone joined before it starts watching, so each phone has an entry here.
  const dropsAtStart = audience.phones.map((phone) => phone.drops)
  const distances: number[] = []
  const sampler = setInterval(
    () => distances.push(...distancesFromMedian(audience.phones.map((phone) => phone.offsetMs()))),
    SAMPLE_EVERY_MS
  )
  const generatorDelay = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS })
  generatorDelay.enable()

  // The histogram holds the time between two of its timer ticks, so an idle
  // loop reads as the resolution itself; only what is above it is delay.
  const delayMs = (ns: number) => Number(Math.max(0, ns / 1e6 - DELAY_RESOLUTION_MS).toFixed(3))

  const stop = () => {
    clearInterval(sampler)
    generatorDelay.disable()
  }

  return {
    /** Stops watching without a result, such as when the run failed. */
    stop,
    /** Stops watching and sums up what every phone saw. */
    finish: (track: TrackShape, chunkCount: number): RunResult => {
      stop()
      const phones = audience.phones
      const arrivals = phones.flatMap((phone) => phone.arrivals)
      const missingChunks = phones.reduce((sum, phone) => {
        const received = new Set(phone.arrivals.map((arrival) => arrival.chunk))
        let missing = 0
        for (let chunk = 0; chunk < chunkCount; chunk++) if (!received.has(chunk)) missing++
        return sum + missing
      }, 0)
      return {
        phones: phones.length,
        track,
        chunkCount,
        arrivalLeadMs: summarize(arrivals.flatMap((arrival) => (arrival.leadMs === null ? [] : [arrival.leadMs]))),
        arrivalsWithoutClock: arrivals.filter((arrival) => arrival.leadMs === null).length,
        missingChunks,
        connects: phones.reduce((sum, phone) => sum + phone.connects, 0),
        dropsDuringTrack: phones.reduce((sum, phone, index) => sum + phone.drops - (dropsAtStart[index] ?? 0), 0),
        dropsBeforeTrack: dropsAtStart.reduce((sum, drops) => sum + drops, 0),
        roundTripMs: summarize(phones.flatMap((phone) => phone.roundTripsMs)),
        roundTripsAtStart: summarize(roundTripsAtStart),
        offsetFromMedianMs: summarize(distances),
        generatorDelayMs: { p99: delayMs(generatorDelay.percentile(99)), max: delayMs(generatorDelay.max) }
      }
    }
  }
}
