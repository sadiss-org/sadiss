import { Frame, TrackSettings } from './types'
import { Chunk, ChunkEnvelope } from './types/ChunkEnvelope'
import { Recipient } from './lib/audience'
import { distributePartials, PartialMap } from './partialDistribution'

const MAX_PARTIALS_PER_CLIENT = 16

/**
 * Turning one frame of a track into the messages its devices are sent.
 *
 * This is where the wire format lives, and it is a pure function of the frame,
 * the devices and the previous chunk's partial assignment: no clock, no sockets,
 * no session state. Released apps parse what comes out of here, so the two modes
 * emit deliberately different shapes and both are pinned by tests.
 */


/** One device's message for one chunk, already serialised. */
export interface DeviceMessage {
  device: Recipient
  json: string
}

export interface ChunkPayloads {
  /** Only the devices with something to play this chunk appear here. */
  messages: DeviceMessage[]
  /** The partial assignment to carry into the next chunk. */
  nextMap: PartialMap
}

const envelope = (chunk: Chunk, playAt: number, settings: TrackSettings) => {
  const message: ChunkEnvelope = { startTime: playAt, waveform: settings.waveform, ttsRate: settings.ttsRate, chunk }
  return JSON.stringify(message)
}

/**
 * Choir mode: a device plays the partial whose index is its choir id, and hears
 * the phrase written for that voice. A device whose voice is not in this frame
 * is sent nothing.
 */
const choirPayloads = (frame: Frame, devices: Recipient[], playAt: number, settings: TrackSettings): DeviceMessage[] => {
  const messages: DeviceMessage[] = []

  for (const device of devices) {
    const chunk: Chunk = {}

    const partialForVoice = frame.partials.find((partial) => partial.index === device.choirId)
    if (partialForVoice) {
      chunk.partials = [partialForVoice]
    }

    if (frame.ttsInstructions) {
      const instruction = frame.ttsInstructions[device.choirId]
      if (instruction) {
        chunk.ttsInstructions = { time: instruction.time, phrase: instruction.langs[device.ttsLang.iso] }
      }
    }

    if (chunk.partials || chunk.ttsInstructions) {
      messages.push({ device, json: envelope(chunk, playAt, settings) })
    }
  }

  return messages
}

/**
 * nonChoir mode: the frame's partials are shared out across whoever is connected,
 * and the frame's first phrase goes to everyone. A device's `partials` key is
 * always present here, empty if the allocation gave it nothing.
 */
const nonChoirPayloads = (
  frame: Frame,
  devices: Recipient[],
  playAt: number,
  settings: TrackSettings,
  previousMap: PartialMap
): ChunkPayloads => {
  const { allocation, nextMap } = distributePartials(
    devices.map((device) => String(device.id)),
    frame.partials ?? [],
    previousMap,
    MAX_PARTIALS_PER_CLIENT
  )

  const messages: DeviceMessage[] = []

  for (const device of devices) {
    const chunk: Chunk = { partials: allocation[String(device.id)] }

    if (frame.ttsInstructions) {
      const firstInstruction = Object.values(frame.ttsInstructions)[0]
      if (firstInstruction) {
        chunk.ttsInstructions = { time: firstInstruction.time, phrase: firstInstruction.langs[device.ttsLang.iso] }
      }
    }

    if (chunk.partials?.length || chunk.ttsInstructions) {
      messages.push({ device, json: envelope(chunk, playAt, settings) })
    }
  }

  return { messages, nextMap }
}

/**
 * The messages one frame produces.
 *
 * `playAt` is the time on the server's clock the devices should sound this chunk.
 */
export const payloadsForChunk = (
  frame: Frame,
  devices: Recipient[],
  playAt: number,
  settings: TrackSettings,
  previousMap: PartialMap
): ChunkPayloads =>
  settings.mode === 'choir'
    ? { messages: choirPayloads(frame, devices, playAt, settings), nextMap: previousMap }
    : nonChoirPayloads(frame, devices, playAt, settings, previousMap)
