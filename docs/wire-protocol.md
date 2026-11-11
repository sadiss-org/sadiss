# The SADISS wire protocol and its versions

App builds live on audience phones and lag behind the server: at any performance
the room is a mix of app generations. So every device announces the protocol
version it speaks, and the server records it per connection.

## How a device announces its version

The device sends `protocolVersion` in the `clientInfo` handshake it makes when
its socket opens:

```json
{ "message": "clientInfo", "clientId": 3, "ttsLang": { "iso": "en-US", "lang": "English" },
  "performanceId": "…", "protocolVersion": 2 }
```

Apps built before versioning existed send the same handshake without that field.
**A handshake without a `protocolVersion` is protocol version 1.**

The version the server itself speaks is `CURRENT_PROTOCOL_VERSION` in
`server/types/Protocol.ts`; the app's is `PROTOCOL_VERSION` in
`app/src/composables/protocol.ts`. Both must be raised together whenever a
message on the wire changes shape.

## Seeing the room before it plays

The server counts the connected clients of a performance per protocol version
and sends the counts to the admin interface in `adminInfo`, together with the
version it speaks itself (`clientsConnectedToPerformanceByProtocolVersion` and
`serverProtocolVersion`). The connected-clients bar in the performance view
shows them, and marks the room whenever a client speaks anything other than the
server's version — including the case where every phone in the room agrees on an
outdated one. A mismatch is therefore visible before playback is started, which
is the point: a performance is a one-shot live event.

Until an app release that speaks the current version reaches the stores and the
phones in the room, every client reports the version below it, so the bar reads
as a mismatch for the whole fleet. That is the display working, not a fault: the
server is deliberately a version ahead of the apps it serves.

## What the admin is sent

An admin is not sent events. Once a second it is sent `adminInfo`, which carries
the whole state of what it asked about: the room, and — when it named a
performance — where that performance has got to, including that nothing is
playing. Every push is complete and replaces the last, so a lost one costs a
second and a socket that drops and comes back repairs itself without replaying
anything.

That is deliberate, and it is what #122 was. State that arrives only as edges
strands a view the moment one is missed: an admin that misses the end of a track
has nothing that will ever tell it the track ended. Playing state is reported the
same way as the client counts already were, rather than announced when it
changes.

The admin interface is served by this server and deployed with it, so this half
of the wire is not versioned. Devices are the versioned half, and they *do* get
events — `{ "start": true }` is what a device zeroes its playback offset on.

## The support window

The server and the admin interface are deployed ahead of the app: a new server
goes live while the builds it serves are still the ones in the stores and on
people's phones. The window is therefore not "current and the one below" but
every version a build still in someone's hands might speak.
`SUPPORTED_PROTOCOL_VERSIONS` in `server/types/Protocol.ts` is that list, and a
version leaves it only when no build speaking it can still be in use.

Admission is not what the window governs — nothing is ever refused for its
version, because turning a phone away during a live event is worse than serving
it. What the window governs is what the server may *change*. Every version in the
list keeps playing against every later server.

`server/tests/wireContract.spec.ts` holds the server to that. For each version it
drives a real socket through a whole track and pins the frames that come back.
Those tests are end to end on purpose: an old build breaks by no longer being
*served* — a stricter parse turning its handshake away, a filter dropping it from
the audience — and none of that is visible to a test that calls the message
builders directly. The shapes those builders emit are pinned separately, without
sockets, in `server/tests/playbackSessionOutput.spec.ts`.

A build below the current version may still mishandle a message whose shape
changed after it was built. The admin's per-version counts are the mitigation:
the operator sees the outdated devices before starting and can have them updated.

## Version history

| Version | Change |
| ------- | ------ |
| 1 | The unversioned handshake. Everything shipped before protocol versioning. |
| 2 | `clientInfo` carries `protocolVersion`. No playback message changed. |
| 3 | `clientInfo` carries `device`, who the phone is; `measure` may carry `report`, the phone's state, while `measureConfig` asks for it (both below). No playback message changed. |

## Who a phone is (version 3)

From version 3 the handshake carries `device`:

```json
{ "message": "clientInfo", "clientId": 3, "ttsLang": { "iso": "en-US", "lang": "English" },
  "performanceId": "…", "protocolVersion": 3,
  "device": { "id": "1f0e6c3a-…", "appVersion": "2.2.0", "appBuild": "12", "platform": "android",
              "osVersion": "13", "model": "MAR-LX1A", "network": "wifi" } }
```

`id` is made up once per installation of the app and kept on the phone, so every
connection of one phone carries the same one, across reconnects and restarts.
The rest is what the phone reports about itself when the connection opens;
`network` is how it reached the network at that moment, so a phone that moves
from WiFi to mobile data says so on its next connection.

Only the performance log reads `device`: its `register` record carries it, or
`unidentified: true` for a build that does not send it. A `device` that is not
an object of seven strings is dropped and the phone registers without it, so a
malformed identity never costs a phone its place in the performance.

## What a phone reports with each ping (version 3)

While the server keeps a performance log, `measureConfig` asks a phone that
speaks version 3 or later for reports with `report: true`:

```json
{ "message": "measureConfig", "config": { "intervalMs": 3000, "report": true } }
```

Without a log, with `PHONE_REPORTS=off` in the server's environment, or for a
build of version 1 or 2, the field is left out, so the message is the one
earlier servers sent; a phone treats a config without it as no. While it is true, each `measure` carries the
phone's state:

```json
{ "message": "measure", "t0": 123456.7,
  "report": {
    "clock": { "offsetMs": 1794334190000.5, "rttMs": 28.4, "roundTrips": 20, "connectedForMs": 61000 },
    "audio": { "scheduleOffsetS": 1794334185.2, "calibrationS": 0.12, "state": "running",
               "outputLatency": 0.04, "baseLatency": 0.005, "sampleRate": 48000,
               "outputTimestamp": { "contextTime": 12.3, "performanceTime": 45678.9 } },
    "visible": true, "keepAlivePlaying": true,
    "lastChunk": { "index": 7, "leadMs": 912.4 } } }
```

- `clock`: the phone's estimate of server time minus its own clock, the median
  round trip of the faster half of its round trips, which the estimate uses, how
  many round trips its window holds, and how long the connection has been open.
- `audio`: how playback is scheduled: server time minus audio-clock time, the
  output latency set on the calibration page, and what the audio context says
  about its state, latencies, sample rate and output timestamp.
- `visible`: whether the app is in the foreground; `keepAlivePlaying`: whether
  the silent sound that keeps audio alive with the screen off plays.
- `lastChunk`: the last chunk with partials the phone was sent, and how long
  before its first sound it arrived by the phone's clock.

A figure the phone cannot give is null. The server answers the ping first and
then, if the socket's handshake said version 3 or later, writes the report as a
`phone` record, with the device id from the
handshake, to the file the connection's records go to. A figure of the wrong
kind is logged as null, and a `report` that is not an object is ignored: the
ping is the shared clock and is always answered.

