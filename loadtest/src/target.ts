import { partialFile, TrackShape, ttsFiles } from './track'

/** A generated track in its own performance on the server under test, ready to play. */
export interface PreparedPerformance {
  /** The id phones join with. */
  id: string
  /** How many chunks the server cut the track into. */
  chunkCount: number
  start(): Promise<void>
  stop(): Promise<void>
}

/** The server under test, as an admin sees it through the HTTP API. */
export interface Target {
  /** Uploads a generated track into a new performance. */
  prepare(shape: TrackShape, label: string): Promise<PreparedPerformance>
}

const fieldOf = (body: unknown, name: string) =>
  typeof body === 'object' && body !== null ? Object.entries(body).find(([key]) => key === name)?.[1] : undefined

const missing = (body: unknown, name: string, what: string) =>
  new Error(`The server's answer to creating the ${what} carried no ${name}: ${JSON.stringify(body)}`)

const stringField = (body: unknown, name: string, what: string) => {
  const value = fieldOf(body, name)
  if (typeof value !== 'string') throw missing(body, name, what)
  return value
}

const numberField = (body: unknown, name: string, what: string) => {
  const value = fieldOf(body, name)
  if (typeof value !== 'number') throw missing(body, name, what)
  return value
}

export const createTarget = async (apiUrl: string, email: string, password: string): Promise<Target> => {
  const login = await fetch(`${apiUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const jwt = login.headers.getSetCookie().find((cookie) => cookie.startsWith('jwt='))
  if (!login.ok || !jwt) throw new Error(`Logging in as ${email} at ${apiUrl} failed with HTTP ${login.status}.`)
  const cookie = jwt.split(';')[0] ?? ''

  const call = async (path: string, init: RequestInit, { notFoundIsFine = false } = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...init.headers, Cookie: cookie } })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok && !(notFoundIsFine && response.status === 404)) {
      throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`)
    }
    return body
  }
  const post = (path: string, body: object, options?: { notFoundIsFine?: boolean }) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, options)

  return {
    async prepare(shape, label) {
      const form = new FormData()
      form.append('name', label)
      form.append('mode', shape.choir ? 'choir' : 'nonChoir')
      form.append('waveform', 'sine')
      form.append('ttsRate', '1')
      form.append('isPublic', 'false')
      form.append('files', new Blob([partialFile(shape)], { type: 'text/plain' }), 'partialfile_loadtest.txt')
      for (const { name, content } of ttsFiles(shape)) form.append('files', new Blob([content], { type: 'text/plain' }), name)
      const track = await call('/api/track/create', { method: 'POST', body: form })
      const trackId = stringField(track, '_id', 'track')
      const chunkCount = numberField(track, 'trackLengthInChunks', 'track')

      const performance = await post('/api/performance/create', { name: label, isPublic: false })
      const id = stringField(performance, '_id', 'performance')
      await post('/api/add-tracks-to-performance', { trackIds: [trackId], performanceId: id })

      return {
        id,
        chunkCount,
        start: async () => {
          await post('/api/track/start', { trackId, performanceId: id, loop: false })
        },
        // A track that has played to its end is no longer running, and the
        // server answers its stop with 404; any other failure is reported.
        stop: async () => {
          await post('/api/track/stop', { performanceId: id }, { notFoundIsFine: true })
        }
      }
    }
  }
}
