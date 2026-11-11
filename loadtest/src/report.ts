import { FIGURES, ms } from './figures'
import { RampEnd, RampStep } from './ramp'
import { RunResult } from './results'
import { Sampled } from './serverSampler'
import { Summary } from './stats'
import { Threshold } from './thresholds'
import { Verdict } from './verdict'

const LABEL_WIDTH = 32

const summaryLine = (figure: keyof RunResult, summary: Summary) => {
  const { label, unit } = FIGURES[figure]
  return `${label.padEnd(LABEL_WIDTH)} median ${unit(summary.median)}, p1 ${unit(summary.p1)}, p95 ${unit(summary.p95)}, p99 ${unit(summary.p99)}, min ${unit(summary.min)}, max ${unit(summary.max)} (${summary.count} values)`
}
const countLine = (figure: keyof RunResult, value: number) => `${FIGURES[figure].label.padEnd(LABEL_WIDTH)} ${FIGURES[figure].unit(value)}`

const BOUNDS: Record<Threshold['bound'], string> = { atLeast: 'at least', atMost: 'at most' }
const checkLine = ({ threshold, value, passed }: Verdict['checks'][number]) => {
  const { label, unit } = FIGURES[threshold.figure]
  const name = threshold.statistic === undefined ? label : `${label} ${threshold.statistic}`
  const measured = `${unit(value)}, ${BOUNDS[threshold.bound]} ${unit(threshold.limit)}`
  return `${name.padEnd(LABEL_WIDTH)} ${measured.padEnd(28)} ${passed ? 'pass' : 'fail'}`
}

const OUTCOMES: Record<Verdict['outcome'], (verdict: Verdict) => string> = {
  pass: () => 'PASS',
  fail: () => 'FAIL: the server missed a threshold.',
  invalid: (verdict) => `INVALID: ${verdict.invalidBecause.join(' ')}`
}

/** Every figure of one run, one check line per threshold, and its outcome. */
export const runReport = (result: RunResult, server: Sampled, verdict: Verdict) => {
  const { track } = result
  const trackLine = [
    `${result.phones} phones, ${result.latePhones} of them joined during the track`,
    track.choir
      ? `choir track of ${result.chunkCount} chunks with ${track.partialsPerFrame} voices`
      : `track of ${result.chunkCount} chunks with ${track.partialsPerFrame} partials per frame`,
    ...(track.tts ? [`a phrase every ${track.tts.everySeconds} s in ${track.tts.langs.join(', ')}`] : [])
  ].join(', ')
  const phraseLines = track.tts
    ? [
        summaryLine('phraseLeadMs', result.phraseLeadMs),
        countLine('missingPhrases', result.missingPhrases),
        countLine('wrongPhrases', result.wrongPhrases),
        countLine('phrasesWithoutClock', result.phrasesWithoutClock)
      ]
    : []
  const serverLines = server.notSampledBecause
    ? [`${'Server'.padEnd(LABEL_WIDTH)} not sampled: ${server.notSampledBecause}`]
    : [
        summaryLine('serverCpuPct', result.serverCpuPct),
        summaryLine('serverRssMb', result.serverRssMb),
        summaryLine('serverSockets', result.serverSockets),
        countLine('serverRestarts', result.serverRestarts ?? 0),
        summaryLine('boxLoad', result.boxLoad),
        summaryLine('boxAvailableMb', result.boxAvailableMb)
      ]
  return [
    trackLine,
    summaryLine('arrivalLeadMs', result.arrivalLeadMs),
    summaryLine('offsetFromMedianMs', result.offsetFromMedianMs),
    summaryLine('lateOffsetFromMedianMs', result.lateOffsetFromMedianMs),
    summaryLine('roundTripMs', result.roundTripMs),
    summaryLine('roundTripsAtStart', result.roundTripsAtStart),
    countLine('missingChunks', result.missingChunks),
    countLine('arrivalsWithoutClock', result.arrivalsWithoutClock),
    countLine('connects', result.connects),
    countLine('dropsDuringTrack', result.dropsDuringTrack),
    countLine('dropsBeforeTrack', result.dropsBeforeTrack),
    ...phraseLines,
    ...serverLines,
    `${FIGURES.generatorDelayMs.label.padEnd(LABEL_WIDTH)} p99 ${ms(result.generatorDelayMs.p99)}, max ${ms(result.generatorDelayMs.max)}`,
    '',
    ...verdict.checks.map(checkLine),
    '',
    OUTCOMES[verdict.outcome](verdict)
  ].join('\n')
}

/** The figures of one ramp step on one line, the clock round trip's p99 among them, so the steps read as a table. */
export const rampStepLine = ({ phones, result, verdict }: RampStep) => {
  const cell = (label: string, value: string, width: number) => `${label} ${value}`.trim().padEnd(width)
  return [
    cell('', `${phones} phones`, 12),
    verdict.outcome.toUpperCase().padEnd(9),
    cell('arrival p1', FIGURES.arrivalLeadMs.unit(result.arrivalLeadMs.p1), 22),
    cell('offset p99', FIGURES.offsetFromMedianMs.unit(result.offsetFromMedianMs.p99), 20),
    cell('round trip median', FIGURES.roundTripMs.unit(result.roundTripMs.median), 30),
    cell('p99', FIGURES.roundTripMs.unit(result.roundTripMs.p99), 14),
    cell('missing', String(result.missingChunks), 11),
    cell('drops', String(result.dropsDuringTrack), 9),
    cell('CPU max', FIGURES.serverCpuPct.unit(result.serverCpuPct.max), 15),
    cell('memory max', FIGURES.serverRssMb.unit(result.serverRssMb.max), 22),
    cell('generator p99', ms(result.generatorDelayMs.p99), 0)
  ]
    // A value wider than its column still keeps a space before the next one.
    .join(' ')
    .trim()
}

const lastPassed = (steps: readonly RampStep[]) => {
  const passed = steps.filter((step) => step.verdict.outcome === 'pass').at(-1)
  return passed ? `The last step that passed had ${passed.phones} phones.` : 'No step passed.'
}

/** How a ramp ended, and the last step that passed. */
export const rampEndReport = (steps: readonly RampStep[], end: RampEnd) => {
  switch (end.kind) {
    case 'break':
      return [`Broke at ${end.phones} phones. ${lastPassed(steps)} It missed:`, ...end.failed.map(checkLine)].join('\n')
    case 'serverStoppedAnswering':
      return `The step with ${end.phones} phones could not be run to its end: ${end.message.replace(/\.$/, '')}. ${lastPassed(steps)}`
    case 'invalid':
      return `INVALID at ${end.phones} phones: ${end.reasons.join(' ')} The ramp says nothing about the server from there on. ${lastPassed(steps)}`
    case 'stoppedByHand':
      return `Stopped by hand after the step with ${end.phones} phones; nothing broke.`
  }
}
