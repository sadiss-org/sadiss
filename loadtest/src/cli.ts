import { parseOptions } from './options'
import { runFixed } from './run'
import { Summary } from './stats'

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

const ms = (value: number | null) => (value === null ? '-' : `${Math.round(value)} ms`)
const line = (label: string, summary: Summary, unit = ms) =>
  `${label.padEnd(28)} median ${unit(summary.median)}, p95 ${unit(summary.p95)}, p99 ${unit(summary.p99)}, min ${unit(summary.min)}, max ${unit(summary.max)} (${summary.count} values)`
const count = (value: number | null) => (value === null ? '-' : String(Math.round(value)))

let result
try {
  result = await runFixed(options, { email, password })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

console.log(
  [
    `${result.phones} phones, track of ${result.chunkCount} chunks with ${result.track.partialsPerFrame} partials per frame`,
    line('Arrival before sound', result.arrivalLeadMs),
    line('Clock offset off the median', result.offsetFromMedianMs),
    line('Measurement round trip', result.roundTripMs),
    line('Round trips at track start', result.roundTripsAtStart, count),
    `${'Missing chunks'.padEnd(28)} ${result.missingChunks}`,
    `${'Chunks before a clock'.padEnd(28)} ${result.arrivalsWithoutClock}`,
    `${'Connects / drops'.padEnd(28)} ${result.connects} / ${result.drops}`,
    `${'Generator event loop'.padEnd(28)} p99 ${result.generatorDelayMs.p99} ms, max ${result.generatorDelayMs.max} ms`
  ].join('\n')
)
