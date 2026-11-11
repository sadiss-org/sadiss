import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { Connection, createConnectionLog } from '../services/connectionLog'
import { PerformanceRecord, ServerRecord } from '../lib/logRecords'

/**
 * Which file a connection's records go to, with the performance lookup answered
 * by the test, in whatever order the network and the database could produce.
 */

type Written = { file: string; record: PerformanceRecord | ServerRecord }

/** A log over files that keep what they are given, and a lookup the test answers by hand. */
const setUp = () => {
  const written: Written[] = []
  const answers: Array<(exists: boolean | undefined) => void> = []
  const log = createConnectionLog(
    {
      for: (performanceId) => ({ write: (record) => written.push({ file: performanceId, record }) }),
      server: { write: (record) => written.push({ file: 'server', record }) }
    },
    () => new Promise((resolve) => answers.push(resolve))
  )
  return { log, written, answers }
}

const device = (): { -readonly [K in keyof Connection]: Connection[K] } => ({
  id: 'phone',
  readyState: WebSocket.OPEN,
  performanceId: '',
  isAdmin: false,
  openedAt: 0,
  choirId: 0,
  ttsLang: { iso: 'en-US', lang: 'English' },
  protocolVersion: 3
})

/** Lets the answers the test gave reach the log. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Each file's records, as `type` or `type reason`, in the order they were written. */
const byFile = (written: Written[]) => {
  const files: Record<string, string[]> = {}
  for (const { file, record } of written) {
    const reason = 'reason' in record ? ` ${record.reason}` : ''
    ;(files[file] ??= []).push(`${record.type}${reason}`)
  }
  return files
}

describe('the connection log', () => {
  it('records the close of a socket that was closing when its lookup answered in the server-wide file only', async () => {
    const { log, written, answers } = setUp()
    const client = device()
    log.opened(client)
    client.performanceId = 'a'.repeat(24)
    log.identified(client)

    // The peer sent a close frame, or the heartbeat gave up on it: ws closes the socket before it reports the close.
    client.readyState = WebSocket.CLOSING
    answers[0](true)
    await settle()
    client.readyState = WebSocket.CLOSED
    log.write(client, { type: 'disconnect', reason: 'closed', code: 1000 })

    expect(byFile(written)).toEqual({ server: ['connect', 'disconnect closed'] })
  })

  it('ends a register that an earlier lookup answered in the same file, whatever later lookups say', async () => {
    const { log, written, answers } = setUp()
    const client = device()
    const first = 'a'.repeat(24)
    log.opened(client)
    client.performanceId = first
    log.identified(client)
    client.performanceId = 'b'.repeat(24)
    log.identified(client)
    client.performanceId = first
    log.identified(client)

    answers[0](true)
    await settle()
    answers[2](undefined)
    await settle()
    log.write(client, { type: 'disconnect', reason: 'closed', code: 1000 })

    expect(byFile(written)).toEqual({ server: ['connect'], [first]: ['register', 'disconnect closed'] })
  })

  it('records each clientInfo as the device sent it, also when two wait on one lookup', async () => {
    const { log, written, answers } = setUp()
    const client = device()
    client.performanceId = 'a'.repeat(24)
    log.identified(client)
    client.choirId = 2
    log.identified(client)

    answers[0](true)
    await settle()

    expect(written.map(({ record }) => ('choirId' in record ? record.choirId : record.type))).toEqual([0, 2])
    expect(answers).toHaveLength(1)
  })

  it('stamps every record it is given with the connection it belongs to', () => {
    const { log, written } = setUp()
    const client = device()

    log.write(client, { type: 'malformedMessage', message: 'measure' })

    expect(written).toEqual([{ file: 'server', record: { type: 'malformedMessage', message: 'measure', connection: 'phone' } }])
  })
})
