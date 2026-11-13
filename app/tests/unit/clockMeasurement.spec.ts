import { MeasureMessage } from '@/types/measurement'

let motion = { pos: -1 }

vi.mock('@/composables/usePlayer', () => ({
  usePlayer: () => ({ setMotionRef: (ref: { pos: number }) => (motion = ref) })
}))

const configuredEvery = (intervalMs: number) => ({ message: 'measureConfig', config: { intervalMs } })

/** The server's reply to a ping, stamped at a fixed server time. */
const answering = (ping: MeasureMessage) => ({
  message: 'measureResponse',
  t0: ping.t0,
  serverRecv: 5_000_000,
  serverSend: 5_000_000
})

describe('clock sync across connections', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the shared clock when a new connection opens', async () => {
    const { useClockMeasurement } = await import('@/composables/useClockMeasurement')
    const measurement = useClockMeasurement()
    const sent: MeasureMessage[] = []

    measurement.start((message) => sent.push(message))
    measurement.handleMessage(configuredEvery(3000))
    vi.advanceTimersByTime(3000)
    measurement.handleMessage(answering(sent[0]))
    const synced = motion.pos

    measurement.start(() => {})

    expect(synced).not.toBe(-1)
    expect(motion.pos).toBe(synced)
  })

  it('pings only over the newest connection, once per interval', async () => {
    const { useClockMeasurement } = await import('@/composables/useClockMeasurement')
    const measurement = useClockMeasurement()
    const first: MeasureMessage[] = []
    const second: MeasureMessage[] = []

    measurement.start((message) => first.push(message))
    measurement.handleMessage(configuredEvery(3000))
    const sentBeforeReplacing = first.length
    measurement.start((message) => second.push(message))
    measurement.handleMessage(configuredEvery(3000))

    vi.advanceTimersByTime(3000)

    expect(first).toHaveLength(sentBeforeReplacing)
    expect(second).toHaveLength(2)
  })

  it('knows the server clock as soon as the first reply comes back, without waiting an interval', async () => {
    const { useClockMeasurement } = await import('@/composables/useClockMeasurement')
    const measurement = useClockMeasurement()
    const sent: MeasureMessage[] = []

    measurement.start((message) => sent.push(message))
    measurement.handleMessage(configuredEvery(3000))
    vi.advanceTimersByTime(50)
    measurement.handleMessage(answering(sent[0]))

    expect(motion.pos).not.toBe(-1)
  })

  it('keeps pinging once per interval when replies arrive between pings', async () => {
    const { useClockMeasurement } = await import('@/composables/useClockMeasurement')
    const measurement = useClockMeasurement()
    const sentAt: number[] = []
    const sent: MeasureMessage[] = []
    const startedAt = Date.now()

    measurement.start((message) => {
      sent.push(message)
      sentAt.push(Date.now() - startedAt)
    })
    measurement.handleMessage(configuredEvery(3000))
    vi.advanceTimersByTime(3000)
    vi.advanceTimersByTime(100)
    measurement.handleMessage(answering(sent[sent.length - 1]))
    vi.advanceTimersByTime(2900)

    expect(sentAt).toEqual([0, 3000, 6000])
  })
})
