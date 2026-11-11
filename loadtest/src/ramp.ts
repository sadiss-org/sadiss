import { RunResult } from './results'
import { Sampled } from './serverSampler'
import { judge, Verdict } from './verdict'

/** One step of a ramp: a room of `phones` phones and what it measured. */
export interface RampStep {
  phones: number
  result: RunResult
  verdict: Verdict
  server: Sampled
}

/** Why a ramp ended, at the step with `phones` phones. */
export type RampEnd =
  /** The step missed at least one threshold: `failed` are the checks it missed, in the order of the thresholds. */
  | { kind: 'break'; phones: number; failed: Verdict['checks'] }
  /** The step could not be run to its end, such as when the server stopped answering the admin API. */
  | { kind: 'serverStoppedAnswering'; phones: number; message: string }
  /** The load generator could not measure the step, so the ramp says nothing about the server from there on. */
  | { kind: 'invalid'; phones: number; reasons: string[] }
  /** Stopped by hand after this step, before anything broke. */
  | { kind: 'stoppedByHand'; phones: number }

/**
 * Runs rooms of `start`, `start + step`, ... phones one after another, with no
 * upper limit, until a room misses a threshold, cannot be run to its end, or
 * cannot be measured, or until a stop is requested once a step has ended.
 */
export const ramp = async ({
  start,
  step,
  runStep,
  onStep,
  stopRequested
}: {
  start: number
  step: number
  runStep: (phones: number) => Promise<{ result: RunResult; server: Sampled }>
  onStep: (step: RampStep) => void
  stopRequested: () => boolean
}): Promise<{ steps: RampStep[]; end: RampEnd }> => {
  const steps: RampStep[] = []
  for (let phones = start; ; phones += step) {
    let run
    try {
      run = await runStep(phones)
    } catch (error) {
      return { steps, end: { kind: 'serverStoppedAnswering', phones, message: error instanceof Error ? error.message : String(error) } }
    }
    const verdict = judge(run.result)
    const done: RampStep = { phones, result: run.result, verdict, server: run.server }
    steps.push(done)
    onStep(done)
    if (verdict.outcome === 'invalid') return { steps, end: { kind: 'invalid', phones, reasons: verdict.invalidBecause } }
    if (verdict.outcome === 'fail') return { steps, end: { kind: 'break', phones, failed: verdict.checks.filter((check) => !check.passed) } }
    if (stopRequested()) return { steps, end: { kind: 'stoppedByHand', phones } }
  }
}
