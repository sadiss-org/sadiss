import { Writable } from 'stream'
import { transports } from 'winston'
import { describe, expect, it } from 'vitest'
import { logger } from '../tools/logger'

/** Collects what the logger writes while `log` runs, through its own format chain. */
const logged = async (log: () => void) => {
  const lines: string[] = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    }
  })
  const capture = logger.add(new transports.Stream({ stream: sink }))

  log()
  // Winston writes through its transports in ticks, so give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 50))
  logger.remove(capture)

  return lines.join('')
}

describe('the logger', () => {
  it('shows what is passed after the message: logging an error finds its reason in the output', async () => {
    const output = await logged(() => logger.error('Failed with:', new Error('disk full')))

    expect(output).toContain('disk full')
  })

  it('shows plain arguments passed after the message, like an error message or a status text', async () => {
    const output = await logged(() => {
      logger.error('Send failed:', 'connection closed')
      logger.error('Failed to upload track:', '502 Bad Gateway')
    })

    expect(output).toContain('connection closed')
    expect(output).toContain('502 Bad Gateway')
  })
})
