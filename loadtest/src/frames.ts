/**
 * The size of a WebSocket frame that carries `payload` bytes: a 2-byte header,
 * 2 or 8 bytes more for a longer payload's length, and a 4-byte mask on every
 * frame a phone sends, since a client masks its frames and a server does not.
 */
export const frameBytes = (payload: number, fromPhone: boolean) =>
  payload + 2 + (payload > 0xffff ? 8 : payload > 125 ? 2 : 0) + (fromPhone ? 4 : 0)

/** The bytes of a message's payload: a text in UTF-8, binary data by its length. */
export const payloadBytes = (data: unknown) => {
  if (typeof data === 'string') return Buffer.byteLength(data)
  if (data instanceof Blob) return data.size
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data.byteLength
  return 0
}
