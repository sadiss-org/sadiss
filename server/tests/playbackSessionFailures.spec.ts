import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from '../playbackSession'
import { Recipient } from '../lib/audience'
import { logger } from '../tools'
import { Frame } from '../types'

/**
 * Chunks are sent from a timer, where nothing above catches what is thrown, so
 * a chunk that cannot be turned into messages would end the process and drop
 * every phone. It costs that one chunk instead.
 *
 * The failing chunk here stores a phrase in the TTS format chunk files had
 * before 2023-08-26, which some files on the server still use.
 */

const frames: Frame[] = JSON.parse(
  JSON.stringify([
    { time: 0, partials: [], ttsInstructions: { 0: { 'en-US': 'A phrase in the old format.' } } },
    { time: 1, partials: [], ttsInstructions: { 0: { time: 1, langs: { 'en-US': 'A phrase in the current format.' } } } }
  ])
)

describe('a playback session with a chunk that cannot be sent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('logs it, keeps playing and sends the next chunk', () => {
    const errors = vi.spyOn(logger, 'error')
    const received: string[] = []
    const phone: Recipient = {
      id: 'phone',
      choirId: 0,
      ttsLang: { iso: 'en-US', lang: 'English' },
      send: (data) => received.push(data)
    }
    const session = new PlaybackSession('650000000000000000000001', 'track', frames, 0, true, {
      mode: 'choir',
      waveform: 'sine',
      ttsRate: 1
    })
    session.start(Date.now() / 1000, () => [phone])

    vi.advanceTimersByTime(2500)

    expect(errors).toHaveBeenCalledWith(expect.stringContaining('chunk 0'))
    expect(received.some((data) => data.includes('A phrase in the current format.'))).toBe(true)
    expect(session.isRunning()).toBe(true)
    session.stop()
  })
})
