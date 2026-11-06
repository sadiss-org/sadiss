export interface TrackShape {
  /** Length of the track in seconds, which is also its number of chunks. */
  seconds: number
  /** How many partials sound in every frame; this sets the size of each chunk. */
  partialsPerFrame: number
}

const FRAME_STEP_S = 0.01

/**
 * A partials file in the text format the server reads on upload (as SPEAR
 * exports it): every partial sounds through the whole track, one frame every
 * 10 ms, each partial at its own steady pitch.
 */
export const partialFile = ({ seconds, partialsPerFrame }: TrackShape) => {
  const frameCount = Math.round(seconds / FRAME_STEP_S)
  const lines = [
    'par-text-frame-format',
    'point-type index frequency amplitude',
    `partials-count ${partialsPerFrame}`,
    `frame-count ${frameCount}`,
    'frame-data'
  ]
  for (let frame = 0; frame < frameCount; frame++) {
    const triples = Array.from({ length: partialsPerFrame }, (_, index) => `${index} ${(220 + index * 55).toFixed(6)} 0.010000`)
    lines.push(`${(frame * FRAME_STEP_S).toFixed(6)} ${partialsPerFrame} ${triples.join(' ')}`)
  }
  return `${lines.join('\n')}\n`
}
