import { performance } from "node:perf_hooks";
import { createClockSync } from "@/composables/clockSync";
import { connectDevice } from "@/composables/deviceConnection";
import { Seat } from "./room";
import { chunkLeadMs } from "@/composables/chunkTiming";
import { frameBytes, payloadBytes } from "./frames";
import { ByteCount } from "./traffic";

export interface PhoneOptions {
  wsUrl: string;
  performanceId: string;
  seat: Seat;
}

/** One chunk as a virtual phone received it. */
export interface Arrival {
  chunk: number;
  /** How long before its first sound it arrived, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
  leadMs: number | null;
}

/** One phrase as a virtual phone was sent it. */
export interface PhraseArrival {
  /** When it is to be spoken, in seconds of track time. */
  time: number;
  /** Its text, or null when the server sent the phrase without one, as for a language the track lacks. */
  text: string | null;
  /** How long before its time it arrived, by the phone's clock estimate, in ms; null when the phone had no estimate yet. */
  leadMs: number | null;
}

export interface VirtualPhone {
  seat: Seat;
  /** When the phone started to connect, on the generator's `performance.now()` clock, in ms. */
  joinedAtMs: number;
  /** When its connection first went live, on the same clock, or null while it never has. */
  firstLiveAtMs: number | null;
  arrivals: Arrival[];
  phrases: PhraseArrival[];
  /** How often a connection was opened, and how often a live one was lost. */
  connects: number;
  drops: number;
  /** The bytes its connections carried, from joining on. */
  bytes: ByteCount;
  /** Round trip of every clock measurement, in ms. */
  roundTripsMs: number[];
  /** The phone's current estimate of server time minus its own, or null before the first round trip. */
  offsetMs(): number | null;
  /** Disconnects for good. */
  close(): void;
}

/**
 * A phone as the app is one: it connects through the app's own device
 * connection and clock sync, so it registers, keeps time and reconnects exactly
 * as a phone does, and records every chunk it is sent. It plays nothing.
 */
export const startVirtualPhone = ({
  wsUrl,
  performanceId,
  seat,
}: PhoneOptions): VirtualPhone => {
  const roundTripsMs: number[] = [];
  const clockSync = createClockSync({
    now: () => performance.now(),
    onRoundTrip: (rttMs) => roundTripsMs.push(rttMs),
  });
  let live = false;
  let closed = false;

  // Counts every connection the app's socket opens, and the bytes of every frame it carries.
  class CountedWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url);
      this.addEventListener("open", () => phone.connects++);
      this.addEventListener("message", (event) => {
        phone.bytes.received += frameBytes(payloadBytes(event.data), false);
      });
    }

    override send(data: Parameters<WebSocket["send"]>[0]) {
      // Only an open socket sends; a closing or closed one drops what it is given.
      if (this.readyState === WebSocket.OPEN)
        phone.bytes.sent += frameBytes(payloadBytes(data), true);
      super.send(data);
    }
  }

  const phone: VirtualPhone = {
    seat,
    joinedAtMs: performance.now(),
    firstLiveAtMs: null,
    arrivals: [],
    phrases: [],
    connects: 0,
    drops: 0,
    bytes: { received: 0, sent: 0 },
    roundTripsMs,
    offsetMs: () => clockSync.clock.offsetMs(),
    close: () => {
      closed = true;
      connection.close();
      clockSync.stop();
    },
  };

  const connection = connectDevice({
    url: wsUrl,
    clientInfo: () => ({
      clientId: seat.choirId,
      ttsLang: seat.ttsLang,
      performanceId,
    }),
    clockSync,
    // Plays nothing; what it keeps of each chunk comes from the connection, which reads it as a phone does.
    onPlayback: () => undefined,
    onChunk: (message, arrival) => {
      if (arrival)
        phone.arrivals.push({ chunk: arrival.chunk, leadMs: arrival.leadMs });
      const phrase = message.chunk.ttsInstructions;
      if (phrase) {
        phone.phrases.push({
          time: phrase.time,
          text: typeof phrase.phrase === "string" ? phrase.phrase : null,
          leadMs: chunkLeadMs(
            (message.startTime + phrase.time) * 1000,
            clockSync.now(),
            clockSync.clock.offsetMs(),
          ),
        });
      }
    },
    onLiveChange: (nowLive) => {
      if (nowLive && phone.firstLiveAtMs === null)
        phone.firstLiveAtMs = performance.now();
      if (live && !nowLive && !closed) phone.drops++;
      live = nowLive;
    },
    WebSocketImpl: CountedWebSocket,
  });

  return phone;
};
