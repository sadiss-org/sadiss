import { describe, expect, it } from 'vitest'
import { performanceOfDevice, webSocketAudience } from '../lib/audience'
import { SadissWebSocketServer } from '../lib/SadissWebsocket'

/**
 * Picking a performance's listeners out of every open connection.
 *
 * This is the half of the output path that has to know about websockets, so it
 * is the half a session's own tests cannot reach.
 */

const PERFORMANCE = '650000000000000000000001'
const OTHER_PERFORMANCE = '650000000000000000000002'

const connection = (id: string, attributes: { performanceId?: unknown; isAdmin?: boolean; choirId?: number } = {}) => ({
  id,
  choirId: attributes.choirId ?? 0,
  ttsLang: { iso: 'en-US', lang: 'English' },
  isAdmin: attributes.isAdmin ?? false,
  performanceId: attributes.performanceId ?? PERFORMANCE,
  safely: [] as string[],
  rawly: [] as string[],
  safeSend(data: string) {
    this.safely.push(data)
  },
  send(data: string) {
    this.rawly.push(data)
  }
})

type Connection = ReturnType<typeof connection>

const audienceOver = (...clients: Connection[]) =>
  webSocketAudience({ clients: new Set(clients) } as unknown as SadissWebSocketServer, PERFORMANCE)

describe('the audience of a performance', () => {
  it('leaves out a connection playing a different performance', () => {
    const ours = connection('ours')
    const theirs = connection('theirs', { performanceId: OTHER_PERFORMANCE })

    expect(audienceOver(ours, theirs)().map((d) => d.id)).toEqual(['ours'])
  })

  // The admin shares the device's choir id, so letting it through would send it
  // the device's audio.
  it('leaves out an admin watching the performance', () => {
    const device = connection('device')
    const admin = connection('admin', { isAdmin: true })

    expect(audienceOver(device, admin)().map((d) => d.id)).toEqual(['device'])
  })

  it('matches a performance id whatever type it arrives as', () => {
    const asString = connection('string')
    const asObject = connection('object', { performanceId: { toString: () => PERFORMANCE } })

    expect(audienceOver(asString, asObject)().map((d) => d.id)).toEqual(['string', 'object'])
  })

  /**
   * A chunk written straight to a socket that is closing takes the process down
   * with it, so the session is handed a send that survives one.
   */
  it('sends through the connection’s guarded send', () => {
    const device = connection('device')

    audienceOver(device)()[0].send('chunk')

    expect(device.safely).toEqual(['chunk'])
    expect(device.rawly).toEqual([])
  })

  it('reports the listeners as they are at the moment it is asked', () => {
    const first = connection('first')
    const clients = new Set([first])
    const readAudience = webSocketAudience({ clients } as unknown as SadissWebSocketServer, PERFORMANCE)

    expect(readAudience()).toHaveLength(1)
    clients.add(connection('second'))
    expect(readAudience()).toHaveLength(2)
  })
})

describe('the performance a connection plays as a device', () => {
  it('is the one it named, read as a string', () => {
    expect(performanceOfDevice(connection('device'))).toBe(PERFORMANCE)
    expect(performanceOfDevice(connection('object', { performanceId: { toString: () => PERFORMANCE } }))).toBe(PERFORMANCE)
  })

  it('is none for an admin watching it, or a connection that has not said', () => {
    expect(performanceOfDevice(connection('admin', { isAdmin: true }))).toBe('')
    expect(performanceOfDevice(connection('new', { performanceId: '' }))).toBe('')
  })
})
