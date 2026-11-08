import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { CHUNK_SECONDS } from '@server/types/ChunkEnvelope'
import { distancesFromMedian, summarize, Summary } from './stats'
import { phrases, phraseText, TrackShape } from './track'
import { Audience } from './audience'
import { ServerFigures } from './serverSampler'
import { VirtualPhone } from './virtualPhone'

export interface RunResult extends ServerFigures {
  phones: number
  /** Phones that joined during the track. */
  latePhones: number
  track: TrackShape
  chunkCount: number
  /** How long before its first sound each chunk arrived, over every phone and chunk, in ms. */
  arrivalLeadMs: Summary
  /** Chunks a phone received before it had any clock estimate. */
  arrivalsWithoutClock: number
  /** Chunks of the track a phone never received, counted per phone, for a late phone from the chunk after the next one sent once it went live. */
  missingChunks: number
  /** Connections the phones opened, from joining to the end of the track. */
  connects: number
  /** Live connections the phones lost from the start of the track until it was stopped, including the tail in which late chunks may still arrive. */
  dropsDuringTrack: number
  /** Live connections the phones lost before the track started, while joining and settling. */
  dropsBeforeTrack: number
  /** Round trip of every clock measurement, from joining to the end of the track, in ms. */
  roundTripMs: Summary
  /** How many clock round trips each phone that joined before the track had completed when it started. */
  roundTripsAtStart: Summary
  /** How far the clock offset of each phone that joined before the track was from the median of those phones, sampled every second while the track played, in ms. */
  offsetFromMedianMs: Summary
  /** How far the clock offset of each late phone was from that same median, sampled alike, in ms. Its clock has had few round trips, so this has no threshold. */
  lateOffsetFromMedianMs: Summary
  /** How long before its time each phrase arrived, over every phone and phrase, in ms. */
  phraseLeadMs: Summary
  /** Phrases a phone received before it had any clock estimate. */
  phrasesWithoutClock: number
  /** Phrases of a phone's voice it never received, counted per phone, for a late phone as for its chunks. */
  missingPhrases: number
  /** Phrases a phone received with the text of another voice or language, without a text, or at a time its voice has none. */
  wrongPhrases: number
  /** How far the load generator's own event loop fell behind, in ms. */
  generatorDelayMs: { p99: number; max: number }
}

const SAMPLE_EVERY_MS = 1000
const DELAY_RESOLUTION_MS = 10
const CHUNK_MS = CHUNK_SECONDS * 1000

/**
 * The first chunk a phone is expected to receive. The server sends chunk k
 * one chunk's time after it sent chunk k - 1, the first a chunk after the start.
 * The next one sent after a phone went live may race its registration, so the
 * phone is expected to receive every chunk from the one after. A phone that
 * never went live is counted from when it started to connect.
 */
const firstExpectedChunk = (phone: VirtualPhone, startedAtMs: number) =>
  Math.max(0, Math.floor(((phone.firstLiveAtMs ?? phone.joinedAtMs) - startedAtMs) / CHUNK_MS) + 1)

const phraseCounts = (phone: VirtualPhone, track: TrackShape, fromChunk: number) => {
  const voice = track.choir ? phone.seat.choirId : 0
  const expected = phrases(track).filter((phrase) => phrase.voice === voice && Math.floor(phrase.time / CHUNK_SECONDS) >= fromChunk)
  const heardAt = new Set(phone.phrases.map((phrase) => phrase.time))
  const scheduled = new Set(phrases(track).filter((phrase) => phrase.voice === voice).map((phrase) => phrase.time))
  return {
    missing: expected.filter((phrase) => !heardAt.has(phrase.time)).length,
    wrong: phone.phrases.filter(
      (phrase) => !scheduled.has(phrase.time) || phrase.text !== phraseText(voice, phone.seat.ttsLang.iso, phrase.time)
    ).length
  }
}

const sum = <T>(items: readonly T[], of: (item: T) => number) => items.reduce((total, item) => total + of(item), 0)

/**
 * Watches an audience while a track plays: every second the clock offsets of
 * the phones in it at that moment, including phones that join later, and
 * throughout the load generator's own event loop. Watching starts as the
 * track is started, so the phones in the audience then are the ones that
 * joined before it.
 */
export const watch = (audience: Audience, now: () => number = () => performance.now()) => {
  const startedAtMs = now()
  const before = audience.phones.length
  const roundTripsAtStart = audience.phones.map((phone) => phone.roundTripsMs.length)
  const dropsAtStart = audience.phones.map((phone) => phone.drops)
  const settled: number[] = []
  const late: number[] = []
  const offsets = (phones: readonly VirtualPhone[]) => phones.map((phone) => phone.offsetMs())
  const sampler = setInterval(() => {
    const { distances, others } = distancesFromMedian(offsets(audience.phones.slice(0, before)), offsets(audience.phones.slice(before)))
    settled.push(...distances)
    late.push(...others)
  }, SAMPLE_EVERY_MS)
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
    finish: (track: TrackShape, chunkCount: number): Omit<RunResult, keyof ServerFigures> => {
      stop()
      const phones = audience.phones
      const arrivals = phones.flatMap((phone) => phone.arrivals)
      const heard = phones.flatMap((phone) => phone.phrases)
      const missingChunks = sum(phones, (phone) => {
        const received = new Set(phone.arrivals.map((arrival) => arrival.chunk))
        let missing = 0
        for (let chunk = firstExpectedChunk(phone, startedAtMs); chunk < chunkCount; chunk++) if (!received.has(chunk)) missing++
        return missing
      })
      const phraseTotals = phones.map((phone) => phraseCounts(phone, track, firstExpectedChunk(phone, startedAtMs)))
      return {
        phones: phones.length,
        latePhones: phones.length - before,
        track,
        chunkCount,
        arrivalLeadMs: summarize(arrivals.flatMap((arrival) => (arrival.leadMs === null ? [] : [arrival.leadMs]))),
        arrivalsWithoutClock: arrivals.filter((arrival) => arrival.leadMs === null).length,
        missingChunks,
        connects: sum(phones, (phone) => phone.connects),
        dropsDuringTrack: sum(phones, (phone) => phone.drops) - sum(dropsAtStart, (drops) => drops),
        dropsBeforeTrack: sum(dropsAtStart, (drops) => drops),
        roundTripMs: summarize(phones.flatMap((phone) => phone.roundTripsMs)),
        roundTripsAtStart: summarize(roundTripsAtStart),
        offsetFromMedianMs: summarize(settled),
        lateOffsetFromMedianMs: summarize(late),
        phraseLeadMs: summarize(heard.flatMap((phrase) => (phrase.leadMs === null ? [] : [phrase.leadMs]))),
        phrasesWithoutClock: heard.filter((phrase) => phrase.leadMs === null).length,
        missingPhrases: sum(phraseTotals, (counts) => counts.missing),
        wrongPhrases: sum(phraseTotals, (counts) => counts.wrong),
        generatorDelayMs: { p99: delayMs(generatorDelay.percentile(99)), max: delayMs(generatorDelay.max) }
      }
    }
  }
}
