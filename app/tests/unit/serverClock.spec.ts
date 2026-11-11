import { ServerClock, roundTripOffset, roundTripRtt, RoundTrip } from '@/composables/serverClock'

// t0/t3 are client performance.now (ms); serverRecv/serverSend are server Date.now (ms).
const rt = (t0: number, serverRecv: number, serverSend: number, t3: number): RoundTrip => ({ t0, serverRecv, serverSend, t3 })

describe('roundTrip helpers', () => {
  it('computes RTT excluding server processing', () => {
    // (t3-t0) - (serverSend-serverRecv) = 30 - 10 = 20
    expect(roundTripRtt(rt(1000, 5000, 5010, 1030))).toBe(20)
  })

  it('computes NTP offset (server - client)', () => {
    // ((serverRecv-t0)+(serverSend-t3))/2 = (4000+3980)/2 = 3990
    expect(roundTripOffset(rt(1000, 5000, 5010, 1030))).toBe(3990)
  })
})

describe('ServerClock', () => {
  it('has no estimate until it has a round trip', () => {
    const clock = new ServerClock()
    expect(clock.offsetMs()).toBeNull()
    expect(clock.posAt(1234)).toBe(-1) // matches MCorp motion.pos "no value" sentinel
  })

  it('derives server time (seconds) from one round trip', () => {
    const clock = new ServerClock()
    clock.add(rt(1000, 5000, 5010, 1030)) // offset 3990 ms
    expect(clock.offsetMs()).toBe(3990)
    // posAt = (perfNow + offset)/1000
    expect(clock.posAt(1030)).toBeCloseTo(5.02, 6)
    expect(clock.posAt(2030)).toBeCloseTo(6.02, 6) // advances with the local clock
  })

  it('ignores high-RTT (biased) round trips in favour of the lowest-RTT ones', () => {
    const clock = new ServerClock(20, 0.5)
    // clean low-RTT sample: offset 1000
    clock.add(rt(0, 1000, 1000, 10)) // rtt 10, offset ((1000)+(990))/2 = 995
    // biased high-RTT sample
    clock.add(rt(0, 2000, 2000, 400)) // rtt 400, offset ((2000)+(1600))/2 = 1800
    // keepFraction 0.5 of 2 -> keep 1 lowest-RTT -> the clean one
    expect(clock.offsetMs()).toBe(995)
  })

  it('evicts samples beyond the window', () => {
    const clock = new ServerClock(2, 1)
    clock.add(rt(0, 100, 100, 2)) // offset 99
    clock.add(rt(0, 200, 200, 2)) // offset 199
    clock.add(rt(0, 300, 300, 2)) // offset 299 -> evicts first
    // window holds the last two (199, 299); median = 249
    expect(clock.offsetMs()).toBe(249)
  })
})

describe('what the clock says about its own estimate', () => {
  it('has nothing to say before the first round trip', () => {
    expect(new ServerClock().estimate()).toBeNull()
  })

  it('gives the offset, the median round trip of the round trips it uses, and how many it holds', () => {
    const clock = new ServerClock(20, 0.5)
    // Round trips of 10, 20, 30 and 40 ms, offset 1000 each; the two fastest are used.
    for (const [i, rtt] of [10, 20, 30, 40].entries())
      clock.add(rt(i * 1000, i * 1000 + 1000 + rtt / 2, i * 1000 + 1000 + rtt / 2, i * 1000 + rtt))
    expect(clock.estimate()).toEqual({ offsetMs: 1000, rttMs: 15, roundTrips: 4 })
  })
})
