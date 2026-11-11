import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHealthSampler } from '../lib/serverHealth'
import { ServerRecord } from '../lib/logRecords'

/** The server's health, sampled on a timer into the server-wide log. */
describe('the health sampler', () => {
  let stop: () => void = () => undefined

  // The delay is measured on the real clock, so the loop below has to hold the real one.
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => stop())

  it('records a blocked event loop in the next sample, with CPU, memory and sockets', async () => {
    const written: ServerRecord[] = []
    stop = startHealthSampler({ everyMs: 400, sockets: () => 7, write: (record) => written.push(record) })

    await new Promise((resolve) => setTimeout(resolve, 50))
    const blockedUntil = Date.now() + 200
    while (Date.now() < blockedUntil) {
      // Holds the event loop, as a slow synchronous handler would.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(written[0]).toEqual({
      type: 'health',
      eventLoopMeanMs: expect.any(Number),
      eventLoopMaxMs: expect.any(Number),
      cpuPct: expect.any(Number),
      heapUsedMb: expect.any(Number),
      rssMb: expect.any(Number),
      sockets: 7
    })
    expect(written[0].type === 'health' && written[0].eventLoopMaxMs).toBeGreaterThanOrEqual(150)
  })

  it('stops sampling when stopped', async () => {
    const written: ServerRecord[] = []
    stop = startHealthSampler({ everyMs: 50, sockets: () => 0, write: (record) => written.push(record) })
    stop()

    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(written).toEqual([])
  })
})
