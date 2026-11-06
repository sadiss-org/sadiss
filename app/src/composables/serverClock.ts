/**
 * The self-hosted shared clock that keeps all devices in sync.
 *
 * Given the four timestamps of each measurement round trip, it recovers the
 * server's clock via the NTP method and exposes it as a position in seconds.
 * Estimation is offset-only over a rolling, lowest-RTT-filtered window: the
 * lowest-RTT round trips are the least path-asymmetric (the main source of NTP
 * bias), and frequent re-estimation absorbs the slow drift measured on real
 * devices (~0.4 ms/min), so no skew term is needed.
 *
 * Pure and dependency-free.
 */

export interface RoundTrip {
  /** Client performance.now (ms) when the ping was sent. */
  t0: number
  /** Server Date.now (ms) when it received the ping. */
  serverRecv: number
  /** Server Date.now (ms) when it sent the response. */
  serverSend: number
  /** Client performance.now (ms) when the response arrived. */
  t3: number
}

/** Round-trip time (ms), excluding time spent on the server. */
export const roundTripRtt = (r: RoundTrip): number => r.t3 - r.t0 - (r.serverSend - r.serverRecv)

/** NTP offset (ms): server clock minus client performance.now. */
export const roundTripOffset = (r: RoundTrip): number => (r.serverRecv - r.t0 + (r.serverSend - r.t3)) / 2

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const upper = s[mid] ?? Number.NaN
  return s.length % 2 ? upper : ((s[mid - 1] ?? upper) + upper) / 2
}

export class ServerClock {
  private samples: { rtt: number; offset: number }[] = []

  /**
   * @param windowSize   number of recent round trips to keep
   * @param keepFraction fraction of the window (lowest-RTT) used for the estimate
   */
  constructor(private readonly windowSize = 20, private readonly keepFraction = 0.5) {}

  /** Feed one measurement round trip. */
  add(r: RoundTrip): void {
    this.samples.push({ rtt: roundTripRtt(r), offset: roundTripOffset(r) })
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  /** Current offset estimate (ms), or null before any round trip. */
  offsetMs(): number | null {
    if (!this.samples.length) return null
    const byRtt = [...this.samples].sort((a, b) => a.rtt - b.rtt)
    const keep = byRtt.slice(0, Math.max(1, Math.floor(byRtt.length * this.keepFraction)))
    return median(keep.map((k) => k.offset))
  }

  /**
   * Estimated shared time in seconds for a given local clock reading (ms).
   * Returns -1 (the player's "no value" sentinel) until the first round trip lands.
   */
  posAt(perfNowMs: number): number {
    const off = this.offsetMs()
    return off === null ? -1 : (perfNowMs + off) / 1000
  }
}
