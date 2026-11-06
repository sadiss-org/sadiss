import type { Threshold } from './verdict'

/** What a run must meet to pass, at 100 phones as at 300. */
export const THRESHOLDS: readonly Threshold[] = [
  // 99% of chunks reach their phone at least 500 ms before they have to sound.
  { figure: 'arrivalLeadMs', statistic: 'p1', bound: 'atLeast', limit: 500, consequence: 'fail' },
  // Every phone receives every chunk of the track.
  { figure: 'missingChunks', bound: 'atMost', limit: 0, consequence: 'fail' },
  // No phone loses its connection while the track plays.
  { figure: 'drops', bound: 'atMost', limit: 0, consequence: 'fail' },
  // 99% of the sampled clock offsets are within 10 ms of the median of all phones.
  { figure: 'offsetFromMedianMs', statistic: 'p99', bound: 'atMost', limit: 10, consequence: 'fail' },
  // The load generator's own event loop fell behind by at most 20 ms at the 99th percentile;
  // beyond that the generator, not the server, was too slow, and the run says nothing about the server.
  { figure: 'generatorDelayMs', statistic: 'p99', bound: 'atMost', limit: 20, consequence: 'invalid' }
]
