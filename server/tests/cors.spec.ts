import { describe, expect, it } from 'vitest'
import { agent } from './setupTests'

describe('CORS whitelist', () => {
  it('allows sadiss.net and fallback.sadiss.net', async () => {
    for (const origin of ['https://sadiss.net', 'https://fallback.sadiss.net']) {
      const res = await agent.get('/api/tracks').set('Origin', origin).expect(200)
      expect(res.headers['access-control-allow-origin']).toBe(origin)
    }
  })

  it('rejects origins outside the whitelist', async () => {
    const res = await agent.get('/api/tracks').set('Origin', 'https://unlisted.example').expect(500)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
