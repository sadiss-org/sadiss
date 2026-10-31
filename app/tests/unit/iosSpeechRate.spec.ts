import { iosSpeechRate } from '@/composables/iosSpeechRate'

describe('iosSpeechRate', () => {
  it('uses the measured iOS rate for a measured Android rate', () => {
    expect(iosSpeechRate('0.2')).toBe(0.15)
    expect(iosSpeechRate('0.8')).toBe(0.92)
    expect(iosSpeechRate('1')).toBe(1.06)
    expect(iosSpeechRate('1.5')).toBe(1.15)
  })

  it('reads the same rate however it is written', () => {
    expect(iosSpeechRate('1.0')).toBe(1.06)
    expect(iosSpeechRate(1)).toBe(1.06)
    expect(iosSpeechRate('0.30000000000000004')).toBeCloseTo(0.2)
  })

  it('places a rate between two measured ones on the straight line between them', () => {
    // halfway between 0.2 -> 0.15 and 0.3 -> 0.2
    expect(iosSpeechRate('0.25')).toBeCloseTo(0.175)
    // halfway between 0.6 -> 0.6 and 0.7 -> 0.8
    expect(iosSpeechRate(0.65)).toBeCloseTo(0.7)
  })

  it('holds a rate outside the measured range at the nearest end', () => {
    expect(iosSpeechRate('0.1')).toBe(0.15)
    expect(iosSpeechRate('1.7')).toBe(1.15)
  })
})
