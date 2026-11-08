import { describe, expect, it } from 'vitest'
import { capacityFrom, checkoutCommit, findServerCommit } from '../src/serverCommit'

const CONFIG = `# comment
CAPACITY_HOST=root@sadiss.net
CAPACITY_DIR=/opt/sadiss-capacity
CAPACITY_URL=https://sadiss.net/capacity
`
const capacity = capacityFrom(CONFIG)

/** A shell that answers each command it knows and fails every other one. */
const shell = (answers: Record<string, string>) => (command: string, args: string[]) => {
  const line = [command, ...args].join(' ')
  const answer = answers[line]
  if (answer === undefined) throw new Error(`unexpected command: ${line}`)
  return answer
}

describe('the commit of the server under test', () => {
  it('reads where the capacity instance lives from its config', () => {
    expect(capacity).toEqual({ host: 'root@sadiss.net', dir: '/opt/sadiss-capacity', url: 'https://sadiss.net/capacity' })
  })

  it('is the one given on the command line, whatever the target', () => {
    expect(findServerCommit({ apiUrl: 'https://sadiss.net/capacity/server', given: 'abc123', capacity, run: shell({}) })).toEqual({ commit: 'abc123', warning: null })
  })

  it('is read from the capacity instance’s deploy record, when its last step finished', () => {
    const run = shell({ 'ssh -o BatchMode=yes root@sadiss.net cat /opt/sadiss-capacity/DEPLOYED.txt': 'ad29734a\ncopied x\ninstalled y\nanswered z\n' })
    expect(findServerCommit({ apiUrl: 'https://sadiss.net/capacity/server', given: undefined, capacity, run })).toEqual({ commit: 'ad29734a', warning: null })
  })

  it('warns when the capacity instance’s deploy did not get as far as answering', () => {
    const run = shell({ 'ssh -o BatchMode=yes root@sadiss.net cat /opt/sadiss-capacity/DEPLOYED.txt': 'ad29734a\ncopied x\n' })
    expect(findServerCommit({ apiUrl: 'https://sadiss.net/capacity/server', given: undefined, capacity, run })).toEqual({
      commit: 'ad29734a',
      warning: expect.stringContaining('did not finish')
    })
  })

  it('is this checkout’s commit for a server on this machine, marked when server/ has uncommitted changes', () => {
    const clean = shell({ 'git rev-parse HEAD': 'f00d\n', 'git status --porcelain -- ../server': '' })
    const dirty = shell({ 'git rev-parse HEAD': 'f00d\n', 'git status --porcelain -- ../server': ' M server/server.ts\n' })
    expect(findServerCommit({ apiUrl: 'http://127.0.0.1:3000', given: undefined, capacity, run: clean })).toEqual({ commit: 'f00d', warning: null })
    expect(findServerCommit({ apiUrl: 'http://localhost:3000', given: undefined, capacity, run: dirty })).toEqual({ commit: 'f00d-dirty', warning: null })
  })

  it('is unknown, with a warning that says how to give it, for any other server or when it cannot be read', () => {
    expect(findServerCommit({ apiUrl: 'https://example.org', given: undefined, capacity, run: shell({}) })).toEqual({
      commit: null,
      warning: expect.stringContaining('--server-commit')
    })
    expect(findServerCommit({ apiUrl: 'https://sadiss.net/capacity/server', given: undefined, capacity, run: shell({}) })).toEqual({
      commit: null,
      warning: expect.stringContaining('--server-commit')
    })
  })
})

describe('the commit of this checkout', () => {
  it('passes every pathspec to git, so a folder can be left out of whether it counts as dirty', () => {
    const run = shell({ 'git rev-parse HEAD': 'f00d\n', 'git status --porcelain -- . :(exclude)results': '' })
    expect(checkoutCommit(run, ['.', ':(exclude)results'])).toBe('f00d')
  })

  it('is null outside a git checkout', () => {
    expect(checkoutCommit(shell({}), ['.'])).toBeNull()
  })
})
