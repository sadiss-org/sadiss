import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseOptions } from './options'
import { ramp } from './ramp'
import { RunMeta, writeRampRecord, writeRecord } from './record'
import { rampEndReport, rampStepLine, runReport } from './report'
import { prepare, runRoom } from './run'
import { checkoutCommit, findServerCommit, readCapacity, runCommand } from './serverCommit'
import { samplingTarget } from './serverSampler'
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

/** 1 is left to a crash, which is what Node exits with on an uncaught error, and 2 to a usage error. */
const EXIT_CODES: Record<Verdict['outcome'], number> = { pass: 0, fail: 3, invalid: 4 }
const RESULTS = fileURLToPath(new URL('../results', import.meta.url))
const warn = (message: string) => console.warn(message)

const capacity = readCapacity()
const serverCommit = findServerCommit({ apiUrl: options.apiUrl, given: options.serverCommit, capacity, run: runCommand })
if (serverCommit.warning) console.warn(serverCommit.warning)
const sampling = samplingTarget(options.apiUrl, capacity)

const meta: RunMeta = {
  serverCommit: serverCommit.commit,
  // The results folder is left out: every run adds an untracked file to it.
  loadtestCommit: checkoutCommit(runCommand, ['.', ':(exclude)results']),
  target: { apiUrl: options.apiUrl, wsUrl: options.wsUrl },
  runAt: new Date().toISOString(),
  note: options.note,
  generator: { cpu: cpus()[0]?.model.trim() ?? 'unknown', threads: cpus().length, node: process.version, platform: process.platform }
}

let performance
try {
  performance = await prepare(options, { email, password })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

if (options.ramp) {
  const { start, step } = options.ramp
  console.log(
    `Ramp from ${start} phones in steps of ${step} against ${options.apiUrl}, server ${meta.serverCommit ?? 'unknown'}, generator ${meta.generator.cpu} with ${meta.generator.threads} threads on Node ${meta.generator.node}`
  )
  // The first Ctrl-C ends the ramp after the step it is running, so its results file is still written; a second one quits at once.
  let stopRequested = false
  process.on('SIGINT', () => {
    if (stopRequested) process.exit(130)
    stopRequested = true
    console.warn('Stopping after this step. Ctrl-C again to quit now, without a results file.')
  })
  const { steps, end } = await ramp({
    start,
    step,
    runStep: (phones) => runRoom(performance, phones, options, warn, sampling),
    onStep: (done) => console.log(rampStepLine(done)),
    stopRequested: () => stopRequested
  })
  console.log(`\n${rampEndReport(steps, end)}`)
  const path = writeRampRecord(RESULTS, {
    ...meta,
    ramp: options.ramp,
    steps: steps.map(({ result, verdict, server }) => ({ result, verdict, serverSamples: server.samples, notSampledBecause: server.notSampledBecause })),
    end
  })
  console.log(`\nKept in ${path}`)
  process.exitCode = end.kind === 'invalid' ? EXIT_CODES.invalid : 0
} else {
  let run
  try {
    run = await runRoom(performance, options.phones, options, warn, sampling)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  const { result, server } = run
  const verdict = judge(result)
  console.log(runReport(result, server, verdict))
  const path = writeRecord(RESULTS, { ...meta, result, verdict, serverSamples: server.samples, notSampledBecause: server.notSampledBecause })
  console.log(`\nKept in ${path}`)
  process.exitCode = EXIT_CODES[verdict.outcome]
}
