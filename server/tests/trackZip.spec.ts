import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTrackZip } from '../services/trackService'
import { createTestTrack } from './testUtils'

/** The zip a track is downloaded as is built in the server's public folder. */
describe('a track zip', () => {
  let cwd = ''

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it('is built in a public folder that does not exist yet, as on a fresh checkout', async () => {
    const track = await createTestTrack('partials')
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sadiss-zip-'))
    // The track's uploaded files stay where they are; only the public folder is missing.
    const uploads = process.env.UPLOADS_DIR ?? ''
    fs.symlinkSync(path.resolve(uploads), path.join(cwd, uploads))
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)

    const zip = await createTrackZip(track)

    expect(path.dirname(zip)).toBe(path.join(cwd, 'public'))
    expect(fs.existsSync(zip)).toBe(true)
  })
})
