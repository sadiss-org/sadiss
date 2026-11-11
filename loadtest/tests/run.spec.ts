import { describe, expect, it } from 'vitest'
import { stopTrack } from '../src/run'

describe('stopping the track once the measurement is over', () => {
  it('warns instead of failing when the server answers the stop with an error', async () => {
    const warnings: string[] = []
    const stop = () => Promise.reject(new Error('/api/track/stop failed with HTTP 500: null'))
    await expect(stopTrack({ stop }, (message) => warnings.push(message))).resolves.toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('/api/track/stop failed with HTTP 500')])
  })

  it('warns instead of failing when the server no longer answers at all', async () => {
    const warnings: string[] = []
    const stop = () => Promise.reject(new TypeError('fetch failed'))
    await expect(stopTrack({ stop }, (message) => warnings.push(message))).resolves.toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('fetch failed')])
  })

  it('warns about a failure that is not an Error', async () => {
    const warnings: string[] = []
    const stop = () => Promise.reject('connection reset')
    await stopTrack({ stop }, (message) => warnings.push(message))
    expect(warnings).toEqual([expect.stringContaining('connection reset')])
  })

  it('says nothing when the stop succeeds', async () => {
    const warnings: string[] = []
    await stopTrack({ stop: () => Promise.resolve() }, (message) => warnings.push(message))
    expect(warnings).toEqual([])
  })
})
