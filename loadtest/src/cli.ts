import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { FIGURES, ms } from './figures'
import { parseOptions } from './options'
import { writeRecord } from './record'
import { RunResult } from './results'
import { runFixed } from './run'
import { checkoutCommit, findServerCommit, readCapacity, runCommand } from './serverCommit'
import { samplingTarget } from './serverSampler'
import { Summary } from './stats'
import { Threshold } from './thresholds'
import { judge, Verdict } from './verdict'

const email = process.env.SADISS_ADMIN_EMAIL
const password = process.env.SADISS_ADMIN_PASSWORD
if (!email || !password) {
  console.error('Set SADISS_ADMIN_EMAIL and SADISS_ADMIN_PASSWORD to an admin account on the server under test.')
  process.exit(2)
}

let options
try {
  options = parseOptions(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
}

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

/** 1 is left to a crash, which is what Node exits with on an uncaught error, and 2 to a usage error. */
const EXIT_CODES: Record<Verdict['outcome'], number> = { pass: 0, fail: 3, invalid: 4 }
const OUTCOMES: Record<Verdict['outcome'], (verdict: Verdict) => string> = {
  pass: () => 'PASS',
  fail: () => 'FAIL: the server missed a threshold.',
  invalid: (verdict) => `INVALID: ${verdict.invalidBecause.join(' ')}`
}

const runAt = new Date().toISOString()
const capacity = readCapacity()
const serverCommit = findServerCommit({ apiUrl: options.apiUrl, given: options.serverCommit, capacity, run: runCommand })
if (serverCommit.warning) console.warn(serverCommit.warning)

let run
try {
  run = await runFixed(options, { email, password }, (message) => console.warn(message), samplingTarget(options.apiUrl, capacity))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const { result, server } = run
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

const verdict = judge(result)
console.log(
  [
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
)

const path = writeRecord(fileURLToPath(new URL('../results', import.meta.url)), {
  serverCommit: serverCommit.commit,
  // The results folder is left out: every run adds an untracked file to it.
  loadtestCommit: checkoutCommit(runCommand, ['.', ':(exclude)results']),
  target: { apiUrl: options.apiUrl, wsUrl: options.wsUrl },
  runAt,
  note: options.note,
  generator: { cpu: cpus()[0]?.model.trim() ?? 'unknown', threads: cpus().length, node: process.version, platform: process.platform },
  result,
  verdict,
  serverSamples: server.samples,
  notSampledBecause: server.notSampledBecause
})
console.log(`\nKept in ${path}`)
process.exitCode = EXIT_CODES[verdict.outcome]
