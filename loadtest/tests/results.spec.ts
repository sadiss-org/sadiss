import { describe, expect, it } from 'vitest'
import { Audience } from '../src/audience'
import { watch } from '../src/results'
import { VirtualPhone } from '../src/virtualPhone'

const TRACK = { seconds: 1, partialsPerFrame: 1 }

const phone = (): VirtualPhone => ({
  arrivals: [{ chunk: 0, leadMs: 900 }],
  connects: 1,
  drops: 0,
  roundTripsMs: [],
  offsetMs: () => 0,
  close: () => undefined
})

const audienceOf = (phones: VirtualPhone[]): Audience => ({
  phones,
  join: () => {
    throw new Error('not used')
  },
  leave: () => undefined
})

describe('the drops of a run', () => {
  it('counts only the drops while the track plays, and reports the drops before it on their own', () => {
    const early = phone()
    early.drops = 2
    const audience = audienceOf([early, phone()])
    const watching = watch(audience)
    early.drops++
    const result = watching.finish(TRACK, 1)
    expect(result.drops).toBe(1)
    expect(result.dropsBeforeTrack).toBe(2)
  })

  it('counts every drop of a phone that joined while the track played', () => {
    const phones = [phone()]
    const watching = watch(audienceOf(phones))
    const late = phone()
    late.drops = 1
    phones.push(late)
    const result = watching.finish(TRACK, 1)
    expect(result.drops).toBe(1)
    expect(result.dropsBeforeTrack).toBe(0)
  })
})
