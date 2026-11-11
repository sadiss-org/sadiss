import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Where the capacity instance lives, as `capacity/config.sh` sets it. */
export interface Capacity {
  host: string
  dir: string
  url: string
  /** The port its server's HTTP API listens on, behind nginx. */
  httpPort: number
}

/** Reads the capacity instance's ssh host, folder, URL and HTTP port from the text of `capacity/config.sh`. */
export const capacityFrom = (config: string): Capacity => {
  const value = (name: string) => {
    const found = new RegExp(`^${name}=(.*)$`, 'm').exec(config)?.[1]
    if (found === undefined) throw new Error(`capacity/config.sh sets no ${name}.`)
    return found.trim()
  }
  return { host: value('CAPACITY_HOST'), dir: value('CAPACITY_DIR'), url: value('CAPACITY_URL'), httpPort: Number(value('CAPACITY_HTTP_PORT')) }
}

export const readCapacity = () => capacityFrom(readFileSync(new URL('../capacity/config.sh', import.meta.url), 'utf-8'))

/** Runs a command and returns what it printed; throws when it fails. */
export type Run = (command: string, args: string[]) => string

export const runCommand: Run = (command, args) => execFileSync(command, args, { encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] })

/** The commit of this checkout, with `-dirty` when the given git pathspecs have uncommitted changes, or null outside a git checkout. */
export const checkoutCommit = (run: Run, pathspecs: string[]) => {
  try {
    const commit = run('git', ['rev-parse', 'HEAD']).trim()
    return run('git', ['status', '--porcelain', '--', ...pathspecs]).trim() ? `${commit}-dirty` : commit
  } catch {
    return null
  }
}

/** Host names of a server on this machine. */
export const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

const UNKNOWN = 'Pass --server-commit to keep it in the results file.'

/**
 * The commit the server under test runs. The server does not say, so it is
 * the one given on the command line; for the capacity instance, the first
 * line of the deploy record it keeps; for a server on this machine, this
 * checkout's commit, since it runs from the checkout. Otherwise it is
 * unknown, and the warning says how to give it.
 */
export const findServerCommit = ({
  apiUrl,
  given,
  capacity,
  run
}: {
  apiUrl: string
  given: string | undefined
  capacity: Capacity
  run: Run
}): { commit: string | null; warning: string | null } => {
  if (given !== undefined) return { commit: given, warning: null }
  if (apiUrl.startsWith(capacity.url)) {
    let record
    try {
      record = run('ssh', ['-o', 'BatchMode=yes', capacity.host, 'cat', `${capacity.dir}/DEPLOYED.txt`])
    } catch {
      return { commit: null, warning: `The capacity instance's deploy record could not be read over ssh. ${UNKNOWN}` }
    }
    const [commit = '', ...steps] = record.trim().split('\n')
    const answered = steps.some((step) => step.startsWith('answered'))
    return {
      commit: commit.trim() || null,
      warning: answered ? null : `The capacity instance's last deploy did not finish, so it may not run ${commit.trim()}.`
    }
  }
  if (LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
    const commit = checkoutCommit(run, ['../server'])
    return commit ? { commit, warning: null } : { commit: null, warning: `This folder is not a git checkout. ${UNKNOWN}` }
  }
  return { commit: null, warning: `The commit of the server at ${apiUrl} is not known. ${UNKNOWN}` }
}
