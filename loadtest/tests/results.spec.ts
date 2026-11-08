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
  it('counts only the drops from the start of the track until it is stopped, and reports the drops before it on their own', () => {
    const early = phone()
    early.drops = 2
    const audience = audienceOf([early, phone()])
    const watching = watch(audience)
    early.drops++
    const result = watching.finish(TRACK, 1)
    expect(result.dropsDuringTrack).toBe(1)
    expect(result.dropsBeforeTrack).toBe(2)
  })

})
