# How SADISS keeps devices in sync

SADISS turns a room full of phones into one instrument, so every phone must play
its audio at the same real-world instant. This document explains how that shared
timing works.

## The problem

Each phone schedules audio against its own `AudioContext` clock
(`ctx.currentTime`). Those clocks start at different moments and drift relative to
one another. To play *together*, all phones need to agree on a single shared
notion of "what time is it now."

**The SADISS server provides that shared clock.** It is the single time authority:
it already dictates the tempo of a performance (it schedules and streams the audio
chunks), so it is also the natural owner of the clock. Every device measures how
far its own clock sits from the server's, and schedules audio accordingly.

> Historically this shared clock came from MotionCorp (MCorp), a third-party
> browser clock. It has been replaced by the self-hosted mechanism below.

## Step 1 — A device measures its offset to the server

Every few seconds each phone performs an NTP-style exchange over the WebSocket it
already holds open (see [serverClock.ts](../app/src/composables/serverClock.ts)
and [measurementController.ts](../app/src/composables/measurementController.ts)):

1. Phone sends `measure` stamped with `t0 = performance.now()` (its local clock, ms).
2. Server receives it at `serverRecv = Date.now()` and replies `measureResponse`
   carrying `t0`, `serverRecv`, and `serverSend = Date.now()`.
3. Phone receives the reply at `t3 = performance.now()`.

From those four timestamps it computes:

```
offset = ((serverRecv − t0) + (serverSend − t3)) / 2   // server clock minus my local clock (ms)
rtt    = (t3 − t0) − (serverSend − serverRecv)          // network round-trip, minus server think-time
```

`offset` is the estimate of "server time minus my time." It is exact when the
network delay is equal in both directions.

## Step 2 — Many round trips become one stable clock

A single round trip is noisy: network jitter perturbs the offset, and cellular
links are *asymmetric* (uplink ≠ downlink), which biases it. `ServerClock`
smooths this out. It keeps a rolling window of the last ~20 round trips and, to
produce the current offset:

- sorts them by `rtt`,
- keeps the **lowest-RTT half** — the fastest round trips are the least jittery
  and least path-asymmetric, i.e. the cleanest measurements,
- takes the **median** of their offsets.

That is the whole filter, and it is enough: on real devices the offset drifts only
~0.4 ms/min, and because the phone re-measures every few seconds it never
accumulates that drift — so an offset-only estimate suffices (no clock-rate term).

`ServerClock` exposes one method:

```
posAt(perfNow) = (perfNow + offset) / 1000     // current server time, in seconds
```

It returns `-1` until the first round trip lands (the "not ready yet" sentinel).

## Step 3 — The clock plugs into the player

The player ([usePlayer.ts](../app/src/composables/usePlayer.ts)) reads the shared
clock through a small injected object, so swapping the clock source touches nothing
else ([useClockMeasurement.ts](../app/src/composables/useClockMeasurement.ts)):

```js
setMotionRef({ get pos() { return clock.posAt(performance.now()) } })
```

Now `motion.pos` returns the server's current time in seconds.

## Step 4 — The player maps server time onto its own audio clock, at the speaker

The player needs one number: server time minus audio-clock time, for the sample
that is leaving the speaker. With it, a moment in **server time** becomes a moment
on **this phone's audio clock**:

```js
offset = speakerOffset(...)                  // (server seconds) − (my audio-clock seconds, at the speaker)
startTimeInCtxTime = startTime − offset      // when, on MY audio clock, that server instant is heard
```

Audio events are then scheduled at `startTimeInCtxTime + breakpoint.time`.

`speakerOffset` ([speakerOffset.ts](../app/src/composables/speakerOffset.ts)) takes
the offset from `ctx.getOutputTimestamp()`, which says which audio-clock time is
leaving the speaker at which `performance.now()`:

- Measuring against `ctx.currentTime` instead would be off by the output latency
  and, on some Android phones, would jump from chunk to chunk, because `currentTime`
  moves there in steps of the audio buffer.
- Chrome's stamp already sits the output latency behind `currentTime`. WebKit's sits
  at `currentTime`, so the `outputLatency` the platform reports is added.
- A phone without a stamp, or with one far from its audio clock (iOS 16 gives stamps
  minutes off), uses `currentTime` plus `outputLatency`.

Delay the phone reports nowhere (some Android phones add about 100 ms of their own)
is left to the hand calibration in expert mode.

## Step 5 — The server stamps the start time in its own clock

When a performer hits start, the admin sends only the track/performance ids — no
timestamp. The server stamps the start moment in its own epoch
([trackController.ts](../server/controllers/trackController.ts)):

```js
const startTime = Date.now() / 1000     // server's own clock, seconds
```

and ships that `startTime` (plus a short lead buffer) inside every chunk. Because
the server owns the clock, the admin needs no clock at all — it just triggers.

## Step 6 — Why the phones end up in sync

- Every phone independently recovers **the same server clock**.
- The server tells them all to start at **the same `startTime`**.
- Each phone converts that identical server instant into the audio-clock time at
  which its speaker plays it: `ctxTime = startTime − (serverTime_me − ctxTime_at_speaker_me)`.

Since `serverTime` is a shared reference each phone knows accurately (~1.5 ms in
testing), they all land on the **same real-world moment**, and the audio is heard
together, apart from delay a phone does not report.

## Component summary

| Component | Role |
| --- | --- |
| **Server** | The single clock authority. Answers `measure` pings and stamps track start times in its own `Date.now()`. |
| **Device** | `ServerClock` derives server time from its own round trips (NTP, lowest-RTT-filtered) and feeds it to the player. |
| **Admin** | Triggers start. Needs no clock. |

The underlying method is the classic NTP / Cristian's algorithm — estimating clock
offset from round-trip timing. SADISS simply points it at a server it owns, and
lets the server that already drives the performance also be the clock.
