/**
 * How far an output timestamp may sit from the render position, in seconds, and
 * still be believed: past the output latency of any phone, Bluetooth included,
 * and the steps `currentTime` moves in. iOS 16 gives stamps minutes off.
 */
const MAX_STAMP_TRAIL_S = 1
const MAX_STAMP_LEAD_S = 0.1
/**
 * How far past the page clock an output timestamp's page time may lie, in ms. A
 * stamp describes a sample that already left the speaker, so a healthy phone's
 * is never more than a few ms ahead.
 */
const MAX_STAMP_FUTURE_MS = 50

/** One reading of the clocks a phone schedules its sound with, all taken at the same moment. */
export interface ClockReading {
  /** The shared server clock, in seconds. */
  serverNowS: number
  /** The page clock (`performance.now()`), in ms. */
  pageNowMs: number
  /** The audio context's render position (`currentTime`), in seconds. */
  renderTimeS: number
  /** How far the platform says its output runs behind the render position, in seconds. */
  outputLatencyS: number | null
  /** `getOutputTimestamp()`: the audio time of the sample leaving the speaker at a page time. */
  stamp: { contextTime: number | null; performanceTime: number | null } | null
}

/**
 * Server time minus audio time at the speaker, in seconds: a sound scheduled
 * at audio time `serverTime - offset` is heard at `serverTime`.
 *
 * The output timestamp pairs audio and page time without the steps
 * `currentTime` moves in on some phones, so it gives the same offset from one
 * chunk to the next. Chrome's stamp already runs the output latency behind the
 * render position; WebKit's sits at the render position, so the latency the
 * platform reports is added there, as it is when there is no usable stamp.
 */
export const speakerOffset = ({ serverNowS, pageNowMs, renderTimeS, outputLatencyS, stamp }: ClockReading): number => {
  const latency = outputLatencyS ?? 0
  const renderOffset = serverNowS - renderTimeS
  // A stamp from before the first sample was output reads 0 for both times.
  if (!stamp?.contextTime || !stamp.performanceTime) return renderOffset + latency

  const serverAtStamp = serverNowS + (stamp.performanceTime - pageNowMs) / 1000
  const outputOffset = serverAtStamp - stamp.contextTime
  const stampTrailsRender = outputOffset - renderOffset
  if (stampTrailsRender > MAX_STAMP_TRAIL_S || stampTrailsRender < -MAX_STAMP_LEAD_S) return renderOffset + latency
  // The stamp either covers the latency or leaves it out; half of it decides
  // which, so that the steps of `currentTime` do not.
  return stampTrailsRender >= latency / 2 ? outputOffset : outputOffset + latency
}

/** An output timestamp as `speakerOffset` takes it. */
type OutputStamp = ClockReading['stamp']

/**
 * The output timestamps of one audio context, each with the page time read
 * right after it, so that a pause between the two reads makes a stamp look
 * older, never newer. `read` gives the context's current stamp.
 *
 * Once a stamp claims a page time in the future, which a stamp of a sample that
 * already left the speaker cannot, the context's stamps are not consistent with
 * each other, and none is given again. Giving only those that look right would
 * switch the offset between two clocks.
 */
export const createStampReader = (read: () => OutputStamp, now: () => number) => {
  let trusted = true
  return (): { stamp: OutputStamp; pageNowMs: number } => {
    const stamp = read()
    const pageNowMs = now()
    if (stamp?.performanceTime != null && stamp.performanceTime > pageNowMs + MAX_STAMP_FUTURE_MS) trusted = false
    return { stamp: trusted ? stamp : null, pageNowMs }
  }
}
