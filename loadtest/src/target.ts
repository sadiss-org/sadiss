import { partialFile, TrackShape } from './track'

/**
 * The server under test, as an admin sees it through the HTTP API: log in, put
 * a generated track into a fresh performance, start and stop it.
 */
export interface Target {
  /** Uploads a generated track into a new performance; returns the performance id phones join. */
  prepare(shape: TrackShape, label: string): Promise<string>
  start(): Promise<void>
  stop(): Promise<void>
}

const idOf = (body: unknown, what: string) => {
  const id = (body as { _id?: unknown })?._id
  if (typeof id !== 'string') throw new Error(`The server's answer to creating the ${what} carried no id: ${JSON.stringify(body)}`)
  return id
}

export const createTarget = async (apiUrl: string, email: string, password: string): Promise<Target> => {
  const login = await fetch(`${apiUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const jwt = login.headers.getSetCookie().find((cookie) => cookie.startsWith('jwt='))
  if (!login.ok || !jwt) throw new Error(`Logging in as ${email} failed with HTTP ${login.status}.`)
  const cookie = jwt.split(';')[0] ?? ''

  const call = async (path: string, init: RequestInit) => {
    const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...init.headers, Cookie: cookie } })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`)
    return body
  }
  const post = (path: string, body: object) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  let trackId = ''
  let performanceId = ''

  return {
    async prepare(shape, label) {
      const form = new FormData()
      form.append('name', label)
      form.append('mode', 'nonChoir')
      form.append('waveform', 'sine')
      form.append('ttsRate', '1')
      form.append('isPublic', 'false')
      form.append('files', new Blob([partialFile(shape)], { type: 'text/plain' }), 'partialfile_loadtest.txt')
      trackId = idOf(await call('/api/track/create', { method: 'POST', body: form }), 'track')
      performanceId = idOf(await post('/api/performance/create', { name: label, isPublic: false }), 'performance')
      await post('/api/add-tracks-to-performance', { trackIds: [trackId], performanceId })
      return performanceId
    },
    async start() {
      await post('/api/track/start', { trackId, performanceId, loop: false })
    },
    async stop() {
      await post('/api/track/stop', { performanceId }).catch(() => undefined)
    }
  }
}
