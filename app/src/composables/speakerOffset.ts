/**
 * How far an output timestamp may sit from the render position, in seconds, and
 * still be believed: past the output latency of any phone, Bluetooth included,
 * and the steps `currentTime` moves in. iOS 16 gives stamps minutes off.
 */
const MAX_STAMP_TRAIL_S = 1
const MAX_STAMP_LEAD_S = 0.1

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
