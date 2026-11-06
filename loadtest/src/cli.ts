import { parseArgs } from 'node:util'
import { Summary } from './measure'
import { runFixed } from './run'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:3000' },
    ws: { type: 'string', default: 'ws://127.0.0.1:8080' },
    phones: { type: 'string', default: '10' },
    seconds: { type: 'string', default: '30' },
    partials: { type: 'string', default: '16' },
    'join-over': { type: 'string', default: '5' },
    settle: { type: 'string', default: '10' }
  }
})

const email = process.env.SADISS_ADMIN_EMAIL
const password = process.env.SADISS_ADMIN_PASSWORD
if (!email || !password) {
  console.error('Set SADISS_ADMIN_EMAIL and SADISS_ADMIN_PASSWORD to an admin account on the server under test.')
  process.exit(2)
}

const ms = (value: number | null) => (value === null ? '-' : `${Math.round(value)} ms`)
const line = (label: string, summary: Summary) =>
  `${label.padEnd(26)} median ${ms(summary.median)}, p95 ${ms(summary.p95)}, p99 ${ms(summary.p99)}, min ${ms(summary.min)}, max ${ms(summary.max)} (${summary.count} values)`

const result = await runFixed({
  apiUrl: values.api,
  wsUrl: values.ws,
  email,
  password,
  phones: Number(values.phones),
  track: { seconds: Number(values.seconds), partialsPerFrame: Number(values.partials) },
  joinOverMs: Number(values['join-over']) * 1000,
  settleMs: Number(values.settle) * 1000
})

console.log(
  [
    `${result.phones} phones, track of ${result.track.seconds} s with ${result.track.partialsPerFrame} partials per frame`,
    line('Arrival before sound', result.arrivalLeadMs),
    line('Clock offset spread', result.offsetSpreadMs),
    line('Measurement round trip', result.roundTripMs),
    `${'Missing chunks'.padEnd(26)} ${result.missingChunks}`,
    `${'Chunks before a clock'.padEnd(26)} ${result.arrivalsWithoutClock}`,
    `${'Connects / drops'.padEnd(26)} ${result.connects} / ${result.drops}`,
    `${'Generator event loop'.padEnd(26)} mean ${result.generatorDelayMs.mean} ms, p99 ${result.generatorDelayMs.p99} ms, max ${result.generatorDelayMs.max} ms`
  ].join('\n')
)
process.exit(0)
