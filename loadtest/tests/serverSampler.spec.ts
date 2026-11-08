import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { capacityFrom } from '../src/serverCommit'
import { parseSamples, samplingTarget, serverFigures, startSampler } from '../src/serverSampler'

const capacity = capacityFrom('CAPACITY_HOST=root@sadiss.net\nCAPACITY_DIR=/opt/x\nCAPACITY_URL=https://sadiss.net/capacity\nCAPACITY_HTTP_PORT=3006\n')

/** One line as the sampling script prints it: box time in ns, pid, CPU ticks, resident kB, sockets, load, available kB, ticks per second. */
const line = (seconds: number, pid: string, ticks: string, rssKb = '204800', sockets = '120') =>
  `sample ${seconds * 1e9} ${pid} ${ticks} ${rssKb} ${sockets} 0.42 6536408 100`

describe('the samples of the server under test', () => {
  it('turns CPU ticks into the share of one core used since the sample before, and kB into MB', () => {
    const samples = parseSamples([
      { atS: 0, line: line(1000, '42', '1000') },
      { atS: 5, line: line(1005, '42', '1050') }
    ])
    expect(samples).toEqual([
      { atS: 0, pid: 42, cpuPct: null, rssMb: 200, sockets: 120, boxLoad: 0.42, boxAvailableMb: 6383.21 },
      { atS: 5, pid: 42, cpuPct: 10, rssMb: 200, sockets: 120, boxLoad: 0.42, boxAvailableMb: 6383.21 }
    ])
  })

  it('has no CPU share across a restart, and no process figures while nothing listens', () => {
    const samples = parseSamples([
      { atS: 0, line: line(1000, '42', '1000') },
      { atS: 5, line: line(1005, '-', '-', '-', '-') },
      { atS: 10, line: line(1010, '43', '30') }
    ])
    expect(samples.map((sample) => [sample.pid, sample.cpuPct, sample.rssMb])).toEqual([
      [42, null, 200],
      [null, null, null],
      [43, null, 200]
    ])
  })

  it('has no restart count when there are no samples, since the server was not watched', () => {
    expect(serverFigures([]).serverRestarts).toBeNull()
  })

  it('ignores lines that are not samples', () => {
    expect(parseSamples([{ atS: 0, line: 'Welcome to Ubuntu' }])).toEqual([])
  })

  it('sums up CPU, memory and sockets, and counts each change of the process as a restart', () => {
    const figures = serverFigures(
      parseSamples([
        { atS: 0, line: line(1000, '42', '1000', '102400') },
        { atS: 5, line: line(1005, '42', '1100', '204800') },
        { atS: 10, line: line(1010, '-', '-', '-', '-') },
        { atS: 15, line: line(1015, '43', '10', '51200') }
      ])
    )
    expect(figures.serverCpuPct).toMatchObject({ count: 1, max: 20 })
    expect(figures.serverRssMb).toMatchObject({ count: 3, max: 200, min: 50 })
    expect(figures.serverRestarts).toBe(1)
    expect(figures.boxLoad).toMatchObject({ count: 4, max: 0.42 })
  })
})

describe('where the server under test is sampled', () => {
  it('is the capacity instance over ssh, by its HTTP port', () => {
    expect(samplingTarget('https://sadiss.net/capacity/server', capacity)).toEqual({
      command: 'ssh',
      args: ['-o', 'BatchMode=yes', 'root@sadiss.net', 'sh', '-s'],
      port: 3006
    })
  })

  it('is this machine without ssh for a server on it, by the port of its URL', () => {
    expect(samplingTarget('http://127.0.0.1:3000', capacity)).toEqual({ command: 'sh', args: ['-s'], port: 3000 })
  })

  it('is nowhere for any other server, with the reason', () => {
    expect(samplingTarget('https://example.org/server', capacity)).toEqual({ notSampledBecause: expect.stringContaining('example.org') })
  })
})

describe('sampling for real', () => {
  it('samples the process that listens on the port, here this test', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const sampler = startSampler({ command: 'sh', args: ['-s'], port }, { everyS: 1, forAtMostS: 30 })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const { samples, notSampledBecause } = await sampler.stop()
    server.close()
    expect(notSampledBecause).toBeNull()
    expect(samples.length).toBeGreaterThanOrEqual(2)
    expect(samples[0]).toMatchObject({ pid: process.pid, sockets: expect.any(Number) })
    expect(samples[0]?.rssMb).toBeGreaterThan(0)
    expect(samples[1]?.cpuPct).toEqual(expect.any(Number))
  })

  it('says why the server was not sampled when the command fails, and the run goes on', async () => {
    const sampler = startSampler({ command: 'sh', args: ['-c', 'echo "Permission denied (publickey)." >&2; exit 255'], port: 1 }, { everyS: 1, forAtMostS: 5 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const { samples, notSampledBecause } = await sampler.stop()
    expect(samples).toEqual([])
    expect(notSampledBecause).toContain('Permission denied')
  })

  it('says why when the command does not exist', async () => {
    const sampler = startSampler({ command: 'no-such-command-for-sampling', args: [], port: 1 }, { everyS: 1, forAtMostS: 5 })
    const { notSampledBecause } = await sampler.stop()
    expect(notSampledBecause).toContain('no-such-command-for-sampling')
  })
})
