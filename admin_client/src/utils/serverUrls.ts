interface LocationLike {
  protocol: string
  host: string
  origin: string
}

/**
 * API and WebSocket URLs for the SADISS server.
 *
 * Uses the build-time env override when non-empty (local dev); otherwise derives
 * same-origin paths from the browser location so one production bundle works on
 * both sadiss.net and fallback.sadiss.net.
 */
export function resolveApiUrl(
  configured: string | undefined,
  location: LocationLike
): string {
  const trimmed = configured?.trim()
  if (trimmed) return trimmed
  return `${location.origin}/server`
}

export function resolveWsUrl(
  configured: string | undefined,
  location: LocationLike
): string {
  const trimmed = configured?.trim()
  if (trimmed) return trimmed
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${location.host}/ws/`
}

export const apiUrl = () =>
  resolveApiUrl(import.meta.env.VITE_APP_API_URL, window.location)

export const wsUrl = () =>
  resolveWsUrl(import.meta.env.VITE_APP_WS_URL, window.location)
