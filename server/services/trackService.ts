import { Types } from 'mongoose'
import { NotFoundError } from '../errors/NotFoundError'
import { Track } from '../models'
import { readAndParseChunkFile } from './fileService'
import { ProcessingError } from '../errors/ProcessingError'
import { getFrames } from './playbackService'
import path from 'path'
import fs from 'fs'
import archiver from 'archiver'
import { logger } from '../tools'
import { TrackDocument } from '../types'
import FormData from 'form-data'
import axios from 'axios'
import { trackRepository } from '../repositories/TrackRepository'
import { trackPerformanceRepository } from '../repositories/TrackPerformanceRepository'

export async function getTracksByCreatorId(creatorId: Types.ObjectId) {
  return await Track.find(
    { $or: [{ isPublic: true }, { creator: creatorId }], deleted: { $ne: true } },
    '_id name notes mode waveform ttsRate creator isPublic partialFile ttsFiles trackLengthInChunks'
  )
    .populate('creator', 'username') // Populate the 'creator' field with 'username'
    .lean()
}

/**
 * Reads a track's chunk file into the frame cache and reports its length, so the
 * admin interface can show a duration and a later start does not wait on disk.
 * This carries no playback state: what is played is decided when playback starts.
 */
export async function loadTrackForPlayback(trackId: Types.ObjectId, performanceId: Types.ObjectId) {
  const track = await trackRepository.findById(trackId)
  if (!track) {
    throw new NotFoundError('Track not found.')
  }

  const trackPerformance = await trackPerformanceRepository.findByTrackAndPerformance(trackId, performanceId)
  if (!trackPerformance) {
    throw new NotFoundError('Track performance not found.')
  }

  const frames = await getFrames(track)

  return { trackLengthInChunks: frames.length }
}

export async function getTrackDataForDownload(trackId: Types.ObjectId) {
  const track = await Track.findOne(
    { _id: trackId },
    '-_id name mode notes ttsInstructions ttsLangs waveform ttsRate ttsFiles partialFile isPublic creator'
  )

  if (!track) {
    throw new NotFoundError('Track not found.')
  }

  return track
}

/** Builds the zip a track is downloaded as, in the server's public folder, and resolves with its path. */
export async function createTrackZip(track: TrackDocument): Promise<string> {
  const publicDir = path.join(process.cwd(), 'public')
  await fs.promises.mkdir(publicDir, { recursive: true })
  const zipFilePath = path.join(publicDir, `${track.name.replace(' ', '_')}.zip`)
  const output = fs.createWriteStream(zipFilePath)
  const archive = archiver('zip', {
    zlib: { level: 9 }
  })

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipFilePath))
    // Without a listener, a file that cannot be written would end the process.
    output.on('error', reject)
    archive.on('error', (err: Error) => reject(err))
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        logger.warn('File not found', err)
      } else {
        logger.error('Error creating zip file', err)
        throw err
      }
    })

    archive.pipe(output)

    archive.append(JSON.stringify(track), { name: 'track.json' })

    const baseFilePath = path.join(process.cwd(), `${process.env.UPLOADS_DIR}`)

    for (const file of track.ttsFiles) {
      if (!file.fileName) {
        continue
      }
      const uniqueFileName = file.lang + '_' + file.voice + '_' + file.origName
      const filePath = path.join(baseFilePath, file.fileName)
      archive.append(fs.createReadStream(filePath), { name: uniqueFileName })
    }

    // Get the file data from uploads folder
    if (track.partialFile) {
      const partialFilePath = path.join(baseFilePath, track.partialFile.fileName)
      archive.append(fs.createReadStream(partialFilePath), { name: track.partialFile.origName })
    }

    archive.finalize()
  })
}

export async function createTrack(
  filename: string,
  name: string,
  mode: string,
  notes: string,
  ttsLangs: Set<string> | undefined,
  waveform: string,
  ttsRate: number | null,
  ttsFiles: Array<{ origName: string; fileName: string }> | null,
  partialFileInfo: { fileName: string; origName: string } | null,
  partialsCount: number,
  isPublic: boolean,
  creator: Types.ObjectId,
  trackLengthInChunks: number
) {
  const track = new Track({
    name,
    chunkFileName: filename,
    notes,
    mode,
    waveform,
    ttsRate,
    ttsFiles,
    creator,
    isPublic,
    trackLengthInChunks
  })

  if (partialFileInfo) {
    track.partialFile = {
      fileName: partialFileInfo.fileName,
      origName: partialFileInfo.origName
    }
  }

  if (mode === 'choir' && partialsCount > 0) {
    track.partialsCount = partialsCount
  }

  if (ttsLangs) {
    track.ttsLangs = Array.from(ttsLangs)
  }

  try {
    await track.save()
    return track
  } catch (err) {
    throw new ProcessingError('Error saving track.')
  }
}

interface TrackJson {
  _id: string
  name: string
  mode: string
  notes: string
  ttsLangs: string[]
  waveform: string
  ttsRate: number
  partialFile: {
    origName: string
    fileName: string
  }
  ttsFiles: {
    voice: string
    lang: string
    origName: string
    fileName: string
  }[]
  isPublic: boolean
  creator: string
}

export async function uploadTrackFromJson(
  trackJsonPath: string,
  publicFolderPath: string,
  uploadUrl: string,
  authCookie: string
) {
  try {
    const trackJson: TrackJson = JSON.parse(fs.readFileSync(trackJsonPath, 'utf8'))

    const formData = new FormData()

    formData.append('name', trackJson.name)
    formData.append('mode', trackJson.mode)
    formData.append('notes', trackJson.notes)
    formData.append('ttsLangs', JSON.stringify(trackJson.ttsLangs))
    formData.append('waveform', trackJson.waveform)
    formData.append('ttsRate', String(trackJson.ttsRate))
    formData.append('isPublic', String(trackJson.isPublic))

    if (trackJson.partialFile) {
      const partialFilePath = path.join(publicFolderPath, trackJson.partialFile.origName)
      if (fs.existsSync(partialFilePath)) {
        const fileNameWithoutExtension = trackJson.partialFile.origName.slice(0, '.txt'.length * -1)
        formData.append('files', fs.createReadStream(partialFilePath) as any, `partialfile_${fileNameWithoutExtension}`)
      } else {
        throw new ProcessingError(`Partial file not found: ${partialFilePath}`)
      }
    }

    trackJson.ttsFiles.forEach((ttsFile, index) => {
      // it is in format lang_voice_filename
      const ttsFilePath = path.join(publicFolderPath, `${ttsFile.lang}_${ttsFile.voice}_${ttsFile.origName}`)
      if (fs.existsSync(ttsFilePath)) {
        const fileNameWithoutExtension = ttsFile.origName.slice(0, '.txt'.length * -1)
        formData.append(
          'files',
          fs.createReadStream(ttsFilePath) as any,
          `ttsfile_${ttsFile.voice}_${ttsFile.lang}_${fileNameWithoutExtension}`
        )
      } else {
        throw new ProcessingError(`TTS file not found: ${ttsFilePath}`)
      }
    })

    const response = await axios.post(`${process.env.API_BASE_URL}/api/track/create`, formData, {
      headers: {
        ...formData.getHeaders(),
        Cookie: authCookie
      }
    })

    if (response.status === 201) {
      return true
    } else {
      logger.error('Failed to upload track:', response.statusText)
      return false
    }
  } catch (err) {
    throw err
  }
}
