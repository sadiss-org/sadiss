import { createMeasurementController } from '@/composables/measurementController'
import { PhoneReport } from '@/types/measurement'

/** Builds a controller with a scripted clock and captured outbound messages. */
const report: PhoneReport = {
  clock: { offsetMs: 12, rttMs: 30, roundTrips: 5, connectedForMs: 20000 },
  audio: null,
  visible: true,
  keepAlivePlaying: false,
  lastChunk: { index: 3, leadMs: 900 }
}

const setup = (opts: { nowSeq?: number[]; report?: () => PhoneReport } = {}) => {
  const sent: any[] = []
  const roundTrips: any[] = []
  let tick = 0
  const nowSeq = opts.nowSeq ? [...opts.nowSeq] : null
  const controller = createMeasurementController({
    now: () => (nowSeq ? nowSeq.shift()! : ++tick),
    send: (message) => sent.push(message),
    onRoundTrip: (rt) => roundTrips.push(rt),
    report: opts.report
  })
  return { controller, sent, roundTrips }
}

describe('measurementController', () => {
  it('adopts cadence from a measureConfig message', () => {
    const { controller } = setup()
    controller.handleMessage({ message: 'measureConfig', config: { intervalMs: 4000 } })
    expect(controller.getIntervalMs()).toBe(4000)
  })

  it('pings with a server-bound measure message stamped by the local clock', () => {
    const { controller, sent } = setup({ nowSeq: [500] })
    controller.ping()
    expect(sent).toEqual([{ message: 'measure', t0: 500 }])
  })

  it('reports the round trip (which drives the clock) when handling a measureResponse', () => {
    const { controller, roundTrips } = setup({ nowSeq: [800] }) // 800 = t3 read on response

    controller.handleMessage({ message: 'measureResponse', t0: 500, serverRecv: 510, serverSend: 511 })

    expect(roundTrips).toEqual([{ t0: 500, serverRecv: 510, serverSend: 511, t3: 800 }])
  })

  it('sends nothing back on a measureResponse: the device keeps the sample to itself', () => {
    const { controller, sent } = setup({ nowSeq: [800] })

    controller.handleMessage({ message: 'measureResponse', t0: 500, serverRecv: 510, serverSend: 511 })

    expect(sent).toHaveLength(0)
  })

  it('ignores unrelated messages', () => {
    const { controller, sent, roundTrips } = setup()
    controller.handleMessage({ message: 'somethingElse' } as any)
    expect(sent).toHaveLength(0)
    expect(roundTrips).toHaveLength(0)
  })

  it('sends the phone report with each ping once the server asks for it', () => {
    const { controller, sent } = setup({ nowSeq: [500], report: () => report })
    controller.handleMessage({ message: 'measureConfig', config: { intervalMs: 3000, report: true } })
    controller.ping()
    expect(sent).toEqual([{ message: 'measure', t0: 500, report }])
  })

  it.each([
    ['says no', { intervalMs: 3000, report: false }],
    ['does not say, as an older one', { intervalMs: 3000 }]
  ])('sends exactly the bare ping when the server %s', (_, config) => {
    const { controller, sent } = setup({ nowSeq: [500], report: () => report })
    controller.handleMessage({ message: 'measureConfig', config })
    controller.ping()
    expect(sent).toEqual([{ message: 'measure', t0: 500 }])
  })

  it('still pings when the report cannot be made', () => {
    const { controller, sent } = setup({
      nowSeq: [500],
      report: () => {
        throw new Error('no audio context')
      }
    })
    controller.handleMessage({ message: 'measureConfig', config: { intervalMs: 3000, report: true } })
    controller.ping()
    expect(sent).toEqual([{ message: 'measure', t0: 500 }])
  })

  it('stamps the ping after the report is made, so making it does not count toward the round trip', () => {
    const order: string[] = []
    const sent: unknown[] = []
    const controller = createMeasurementController({
      now: () => {
        order.push('stamped')
        return 500
      },
      send: (message) => sent.push(message),
      report: () => {
        order.push('report made')
        return report
      }
    })
    controller.handleMessage({ message: 'measureConfig', config: { intervalMs: 3000, report: true } })

    controller.ping()

    expect(order).toEqual(['report made', 'stamped'])
  })
})
