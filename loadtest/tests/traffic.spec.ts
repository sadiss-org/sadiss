import { describe, expect, it } from 'vitest'
import { frameBytes, payloadBytes, tally, trafficBetween } from '../src/traffic'
import { VirtualPhone } from '../src/virtualPhone'

describe('the size of a WebSocket frame', () => {
  it('adds a 2-byte header to a payload of up to 125 bytes', () => {
    expect(frameBytes(0, false)).toBe(2)
    expect(frameBytes(125, false)).toBe(127)
  })

  it('adds 2 more bytes of length to a payload of 126 bytes up to 64 KiB', () => {
    expect(frameBytes(126, false)).toBe(130)
    expect(frameBytes(65_535, false)).toBe(65_539)
  })

  it('adds 8 bytes of length to a larger payload', () => {
    expect(frameBytes(65_536, false)).toBe(65_546)
  })

  it('adds a 4-byte mask to a frame a phone sends', () => {
    expect(frameBytes(125, true)).toBe(131)
  })
})

describe('the size of a message', () => {
  it('counts a text in UTF-8 bytes', () => {
    expect(payloadBytes('{"a":1}')).toBe(7)
    expect(payloadBytes('ü')).toBe(2)
  })

  it('counts binary data by its length', () => {
    expect(payloadBytes(new ArrayBuffer(16))).toBe(16)
    expect(payloadBytes(new Uint8Array(8))).toBe(8)
    expect(payloadBytes(new Blob(['abc']))).toBe(3)
  })
})

const phone = (joinedAtMs: number, received: number, sent: number): Pick<VirtualPhone, 'joinedAtMs' | 'bytes'> => ({
  joinedAtMs,
  bytes: { received, sent }
})

describe('the bytes per second of each phone between two tallies', () => {
  it('divides what each phone received and sent in between by the seconds in between', () => {
    const before = tally([phone(0, 1000, 100), phone(0, 2000, 200)], 10_000)
    const after = tally([phone(0, 9000, 300), phone(0, 10_000, 600)], 12_000)
    const { received, sent } = trafficBetween(before, after)
    expect(received).toMatchObject({ count: 2, min: 4000, max: 4000 })
    expect(sent).toMatchObject({ count: 2, min: 100, max: 200 })
  })

  it('counts a phone that joined in between from when it joined', () => {
    const before = tally([phone(0, 0, 0)], 10_000)
    const after = tally([phone(0, 8000, 0), phone(11_000, 4000, 50)], 12_000)
    const { received, sent } = trafficBetween(before, after)
    expect(received).toMatchObject({ count: 2, min: 4000, max: 4000 })
    expect(sent.max).toBe(50)
  })

  it('leaves out a phone that joined as the later tally was taken', () => {
    const before = tally([phone(0, 0, 0)], 10_000)
    const after = tally([phone(0, 8000, 0), phone(12_000, 0, 0)], 12_000)
    expect(trafficBetween(before, after).received.count).toBe(1)
  })

  it('has no values without phones', () => {
    expect(trafficBetween(tally([], 0), tally([], 1000)).received.count).toBe(0)
  })
})
