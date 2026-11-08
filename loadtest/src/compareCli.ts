import { compareRuns } from './compare'
import { readRecord } from './record'

const paths = process.argv.slice(2)
if (paths.length < 2) {
  console.error('Give two or more results files; the first is the baseline the others are compared with.')
  process.exit(2)
}

let records
try {
  records = paths.map(readRecord)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
}

const LABEL_WIDTH = 34
const COLUMN_WIDTH = 22
const short = (commit: string | null) => (commit === null ? 'unknown' : commit.slice(0, 8) + (commit.endsWith('-dirty') ? '-dirty' : ''))
const line = (label: string, cells: string[]) => `${label.padEnd(LABEL_WIDTH)}${cells.map((cell) => cell.padEnd(COLUMN_WIDTH)).join('')}`.trimEnd()

const { rows, differences } = compareRuns(records)
console.log(
  [
    line('Run', records.map((_, index) => (index === 0 ? 'baseline' : `run ${index + 1}`))),
    line('Run at', records.map((record) => record.runAt.slice(0, 16).replace('T', ' ') + (record.runAt.includes('T') ? ' UTC' : ''))),
    line('Server commit', records.map((record) => short(record.serverCommit))),
    line('Target', records.map((record) => new URL(record.target.apiUrl).host)),
    line('Phones', records.map((record) => `${record.result.phones} (${record.result.latePhones} late)`)),
    line('Outcome', records.map((record) => record.verdict.outcome.toUpperCase())),
    '',
    ...rows.map(({ label, unit, cells }) => line(label, cells.map(({ value, worse }) => `${unit(value)}${worse ? '  WORSE' : ''}`))),
    ...(differences.length ? ['', ...differences.map((difference) => `Note: ${difference}`)] : []),
    '',
    'WORSE: further from good than the baseline by more than 10% or 5 ms for a time, or by any amount for a count.'
  ].join('\n')
)
paths.forEach((path, index) => console.log(`${index === 0 ? 'baseline' : `run ${index + 1}`}: ${path}`))
