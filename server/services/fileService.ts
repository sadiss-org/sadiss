import fs from 'fs'
type File = Express.Multer.File
import { Frame, TrackDocument } from '../types'

/**
 * A track's frames, one per second. The chunk file stores a second that holds
 * neither a tone nor a phrase as null, as between the phrases of a TTS track;
 * it is read as a frame with nothing in it, so every frame can be played.
 */
export async function readAndParseChunkFile(track: Pick<TrackDocument, 'chunkFileName'>): Promise<Frame[] | undefined> {
  try {
    const data = fs.readFileSync(`${process.env.CHUNKS_DIR}/${track.chunkFileName}`)
    const stored: (Frame | null)[] = JSON.parse(data.toString())
    return stored.map((frame) => frame ?? { partials: [], ttsInstructions: {} })
  } catch (err) {
    console.error(err)
  }
}

export function getPartialFileByPrefix(files: File[], partialFilePrefix: string) {
  const partialFile = files.find((file) => file.originalname.startsWith(partialFilePrefix))
  if (partialFile) {
    const partialFileInfo = {
      origName: partialFile.originalname.replace(partialFilePrefix, '') + '.txt',
      fileName: partialFile.filename,
      path: partialFile.path
    }
    return partialFileInfo
  }
  return null
}
