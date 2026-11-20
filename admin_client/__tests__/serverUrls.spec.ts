import { describe, expect, it } from "vitest"
import { resolveApiUrl, resolveWsUrl } from "../src/utils/serverUrls"

const httpsLocation = {
  protocol: "https:",
  host: "fallback.sadiss.net",
  origin: "https://fallback.sadiss.net",
}

const httpLocation = {
  protocol: "http:",
  host: "localhost:5173",
  origin: "http://localhost:5173",
}

describe("resolving server URLs", () => {
  it("uses the configured API URL when set", () => {
    expect(resolveApiUrl("http://localhost:3000", httpsLocation)).toBe(
      "http://localhost:3000"
    )
  })

  it("derives the API URL from the page origin when unconfigured or blank", () => {
    expect(resolveApiUrl(undefined, httpsLocation)).toBe(
      "https://fallback.sadiss.net/server"
    )
    expect(resolveApiUrl("", httpsLocation)).toBe(
      "https://fallback.sadiss.net/server"
    )
    expect(resolveApiUrl("   ", httpsLocation)).toBe(
      "https://fallback.sadiss.net/server"
    )
  })

  it("uses the configured WebSocket URL when set", () => {
    expect(resolveWsUrl("ws://192.168.0.95:8080", httpsLocation)).toBe(
      "ws://192.168.0.95:8080"
    )
  })

  it("derives a wss URL for https pages and ws for http pages when unconfigured or blank", () => {
    expect(resolveWsUrl(undefined, httpsLocation)).toBe(
      "wss://fallback.sadiss.net/ws/"
    )
    expect(resolveWsUrl("", httpsLocation)).toBe(
      "wss://fallback.sadiss.net/ws/"
    )
    expect(resolveWsUrl(undefined, httpLocation)).toBe(
      "ws://localhost:5173/ws/"
    )
  })
})
