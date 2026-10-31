/**
 * Converts a track's speech rate, which is tuned by ear on Android, into the
 * rate that sounds the same on iOS.
 *
 * Pure and dependency-free.
 */

/**
 * Android rate and the iOS rate found by ear to sound the same, in ascending
 * order. They depend on how the text-to-speech plugin scales the rate on iOS,
 * so a plugin upgrade that changes that scaling means listening again.
 */
const measuredRates: ReadonlyArray<readonly [android: number, ios: number]> = [
  [0.2, 0.15],
  [0.3, 0.2],
  [0.4, 0.3],
  [0.5, 0.5],
  [0.6, 0.6],
  [0.7, 0.8],
  [0.8, 0.92],
  [0.9, 1.05],
  [1.0, 1.06],
  [1.1, 1.07],
  [1.2, 1.08],
  [1.3, 1.1],
  [1.4, 1.12],
  [1.5, 1.15]
]

/**
 * A rate between two measured ones lies on the straight line between them; one
 * outside the measured range is held at the nearest end.
 */
export const iosSpeechRate = (rate: string | number): number => {
  const android = +rate
  const [slowest, fastest] = [measuredRates[0], measuredRates[measuredRates.length - 1]]
  if (android <= slowest[0]) return slowest[1]
  if (android >= fastest[0]) return fastest[1]

  const upper = measuredRates.findIndex(([measured]) => measured >= android)
  const [androidBelow, iosBelow] = measuredRates[upper - 1]
  const [androidAbove, iosAbove] = measuredRates[upper]
  const share = (android - androidBelow) / (androidAbove - androidBelow)
  return iosBelow + share * (iosAbove - iosBelow)
}
