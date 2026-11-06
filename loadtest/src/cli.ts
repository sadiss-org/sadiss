import { parseOptions } from './options'
import { RunResult } from './results'
import { runFixed } from './run'
import { Summary } from './stats'
import { judge, Threshold, Verdict } from './verdict'

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

const ms = (value: number | null) => (value === null ? '-' : `${Number(value.toFixed(2))} ms`)
const count = (value: number | null) => (value === null ? '-' : String(Math.round(value)))

/** How each figure of a run is named and shown, in the figure lines and in the check lines alike. */
const FIGURES: Record<keyof RunResult, { label: string; unit: (value: number | null) => string }> = {
  phones: { label: 'Phones', unit: count },
  track: { label: 'Track', unit: count },
  chunkCount: { label: 'Chunks in the track', unit: count },
  arrivalLeadMs: { label: 'Arrival before sound', unit: ms },
  offsetFromMedianMs: { label: 'Clock offset off the median', unit: ms },
  roundTripMs: { label: 'Measurement round trip', unit: ms },
  roundTripsAtStart: { label: 'Round trips at track start', unit: count },
  missingChunks: { label: 'Missing chunks', unit: count },
  arrivalsWithoutClock: { label: 'Chunks before a clock', unit: count },
  connects: { label: 'Connects', unit: count },
  drops: { label: 'Drops', unit: count },
  generatorDelayMs: { label: 'Generator event loop', unit: ms }
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
const OUTCOMES: Record<Verdict['outcome'], string> = {
  pass: 'PASS',
  fail: 'FAIL: the server missed a threshold.',
  invalid: 'INVALID: the load generator fell behind, so this run says nothing about the server.'
}

let result
try {
  result = await runFixed(options, { email, password }, (message) => console.warn(message))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const verdict = judge(result)
console.log(
  [
    `${result.phones} phones, track of ${result.chunkCount} chunks with ${result.track.partialsPerFrame} partials per frame`,
    summaryLine('arrivalLeadMs', result.arrivalLeadMs),
    summaryLine('offsetFromMedianMs', result.offsetFromMedianMs),
    summaryLine('roundTripMs', result.roundTripMs),
    summaryLine('roundTripsAtStart', result.roundTripsAtStart),
    countLine('missingChunks', result.missingChunks),
    countLine('arrivalsWithoutClock', result.arrivalsWithoutClock),
    countLine('connects', result.connects),
    countLine('drops', result.drops),
    `${FIGURES.generatorDelayMs.label.padEnd(LABEL_WIDTH)} p99 ${ms(result.generatorDelayMs.p99)}, max ${ms(result.generatorDelayMs.max)}`,
    '',
    ...verdict.checks.map(checkLine),
    '',
    OUTCOMES[verdict.outcome]
  ].join('\n')
)
process.exitCode = EXIT_CODES[verdict.outcome]
