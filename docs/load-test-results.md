# Load test results

What load tests against the capacity instance found. How to run them is in [`loadtest/README.md`](../loadtest/README.md); each run's figures are in its results file in [`loadtest/results/`](../loadtest/results/).

## Ramp, 2026-11-23: broke at 175 phones on a cable to the router

The ramp of 2026-11-10 repeated with the laptop on a cable to the home router instead of WiFi, to see whether the WiFi is what broke. The server commit changed too, see below.

| What | Value |
| --- | --- |
| Results file | [`2026-11-23T1734Z-sadiss.net-capacity-server-ramp.json`](../loadtest/results/2026-11-23T1734Z-sadiss.net-capacity-server-ramp.json) |
| Server commit | `02734322`, with `PERFORMANCE_LOG_DIR` unset. Newer than the `d14b3296` of the earlier ramps: it adds the performance log and fixes for messages and sends that could crash the server |
| Target | the capacity instance through nginx and TLS, with no connection on the live instance's ports before the run |
| Generator | the same laptop, Node v22.23.5, on a 1 Gbit/s cable to the home router and through the same home internet line |
| Ramp | as on 2026-11-10: 25 phones, 25 more each step; nonChoir track of 30 chunks with 16 partials per frame; about one phone in ten joins during the track (3 of 25 up to 18 of 175) |
| Last step that passed | 150 phones |
| Broke at | 175 phones |
| What broke first | arrival before sound p1: -1117 ms, against at least 500 ms. No chunk missing, no drop, clock offset p99 1.47 ms, generator event loop p99 1.62 ms |

Per step:

| Phones | Outcome | Arrival p1 | Arrival min | Round trip median | Round trip p99 | Round trip max | Server CPU max | Server memory max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | PASS | 933 ms | 930 ms | 21.9 ms | 27 ms | 70 ms | 2.0% | 116 MB |
| 50 | PASS | 967 ms | 963 ms | 22.0 ms | 29 ms | 52 ms | 3.4% | 117 MB |
| 75 | PASS | 963 ms | 949 ms | 21.9 ms | 30 ms | 95 ms | 3.8% | 117 MB |
| 100 | PASS | 956 ms | 943 ms | 22.0 ms | 30 ms | 253 ms | 3.4% | 117 MB |
| 125 | PASS | 942 ms | 907 ms | 21.9 ms | 30 ms | 324 ms | 4.6% | 120 MB |
| 150 | PASS | 928 ms | 823 ms | 22.1 ms | 249 ms | 540 ms | 5.2% | 121 MB |
| 175 | FAIL | -1117 ms | -2865 ms | 22.8 ms | 1565 ms | 3065 ms | 8.7% | 121 MB |

The box's load stayed at or below 0.38 in every step.

### What the three ramps say together

Measured: on the cable the round trip p99 stayed at 27 to 30 ms up to 125 phones, where both WiFi ramps had a step with a p99 of 250 ms or more at 125 phones or fewer; single slow round trips of up to 324 ms still came at 100 and 125 phones. At 150 phones the p99 rose to 249 ms. At 175 it broke the way both WiFi ramps did: the median round trip stayed at 23 ms, as in the steps before, while the p99 rose to 1.6 s and at least 1% of chunk arrivals came after their sound, up to 2.9 s late. The server's process peaked at 8.7% of one core, against under 4% in the WiFi breaks.

Inferred, not shown: the cable kept the slow round trips out of the p99 below 150 phones but did not move the break, so the WiFi was not what broke. The newer server commit is unlikely to have moved it either: its log was off, the rest are crash fixes, and the server's process stayed under 9% of one core; this run does not rule it out. Between generator and server are still the home internet line, the internet in between and nginx on the box. A generator near the box (#198) takes the home line and the internet out of the path and leaves nginx and the server: if it carries well past 175 phones, the break is on the home line or the internet; if it breaks near 175, it is in nginx or the server.

## Logging on and off, 2026-11-10: no difference beyond run-to-run noise

The performance log (PR #199) against the capacity instance, at the last step today's ramp passed: 100 phones, 10 of them joining during the track, a nonChoir track of 30 chunks with 16 partials per frame. Two runs with `PERFORMANCE_LOG_DIR` unset, then two with it set, the instance restarted in between. Server commit `0c565a68`; generator and network as in the ramps below.

| Run | Results file | Outcome | Arrival p1 | Arrival median | Arrival min | Round trip median | Round trip p99 | Server CPU max | Server memory max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Off 1 | [`2026-11-10T1752Z`](../loadtest/results/2026-11-10T1752Z-sadiss.net-capacity-server-100p.json) | PASS | 887 ms | 926 ms | 871 ms | 23.5 ms | 40 ms | 8.1% | 119 MB |
| Off 2 | [`2026-11-10T1754Z`](../loadtest/results/2026-11-10T1754Z-sadiss.net-capacity-server-100p.json) | FAIL | 148 ms | 916 ms | -1273 ms | 24.4 ms | 259 ms | 3.8% | 121 MB |
| On 1 | [`2026-11-10T1756Z`](../loadtest/results/2026-11-10T1756Z-sadiss.net-capacity-server-100p.json) | PASS | 782 ms | 921 ms | 757 ms | 23.7 ms | 107 ms | 5.9% | 131 MB |
| On 2 | [`2026-11-10T1758Z`](../loadtest/results/2026-11-10T1758Z-sadiss.net-capacity-server-100p.json) | PASS | 685 ms | 927 ms | 85 ms | 23.5 ms | 56 ms | 5.2% | 120 MB |

No run missed a chunk or dropped a phone; the generator's event loop p99 stayed under 1 ms. Each logged run wrote 100 `register`, one `start`, one `ended` and 100 `disconnect` to its performance file, and `server.jsonl` 200 `connect`; no `dropped` record.

Measured: the median arrival and round trip are the same with and without the log, and the server stayed under 9% of one core either way. The run that failed had logging off: a burst of slow round trips on the path, like the ramps' breaks.

Not measured here: the server's own event-loop lag (the load test samples CPU and memory, not the event loop), and how many phones the server carries with the log on, since this path breaks before the server does.

## Ramp, 2026-11-10: broke at 125 phones, the same way, from the same WiFi

The ramp of 2026-11-08 repeated with the same server, generator and network, to see whether 175 phones repeats. The load test had changed in between: about one phone in ten now joins during the track.

| What | Value |
| --- | --- |
| Results file | [`2026-11-10T1737Z-sadiss.net-capacity-server-ramp.json`](../loadtest/results/2026-11-10T1737Z-sadiss.net-capacity-server-ramp.json) |
| Server commit | `d14b3296`, as on 2026-11-08 |
| Target, generator | as on 2026-11-08: the capacity instance through nginx and TLS with the live instance idle, the same laptop on home WiFi |
| Ramp | 25 phones, 25 more each step; nonChoir track of 30 chunks with 16 partials per frame; about one phone in ten joins during the track (3 of 25 up to 13 of 125) |
| Last step that passed | 100 phones |
| Broke at | 125 phones |
| What broke first | arrival before sound p1: -1253 ms, against at least 500 ms. No chunk missing, no drop, clock offset p99 0.98 ms, generator event loop p99 1.04 ms |

Per step:

| Phones | Outcome | Arrival p1 | Arrival min | Round trip median | Round trip p99 | Round trip max | Server CPU max | Server memory max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | PASS | 843 ms | 841 ms | 24.5 ms | 37 ms | 56 ms | 2.0% | 138 MB |
| 50 | PASS | 945 ms | 910 ms | 23.9 ms | 35 ms | 58 ms | 2.0% | 138 MB |
| 75 | PASS | 567 ms | 243 ms | 24.1 ms | 251 ms | 574 ms | 1.6% | 138 MB |
| 100 | PASS | 916 ms | 904 ms | 23.8 ms | 58 ms | 348 ms | 6.6% | 138 MB |
| 125 | FAIL | -1253 ms | -2873 ms | 24.3 ms | 1581 ms | 3049 ms | 2.4% | 126 MB |

The box's load stayed at or below 0.08 in every step.

### What the two ramps say together

Measured: the step that broke was 175 phones on 2026-11-08 and 125 today, with the same server and network; today about one phone in ten joined during the track, on 2026-11-08 none did. Both times the median round trip stayed at 24 to 26 ms while the p99 jumped past 1.5 s, a few chunks arrived seconds late, and the server's process used under 4% of one core. At 75 phones today a smaller burst of slow round trips (p99 251 ms) passed the thresholds.

Inferred, not shown: with an idle server and the same shape of break both times, the path between generator and box looks like the limit, not the server. Whether the late joiners moved the break from 175 to 125 phones, these two runs cannot tell. The server's own limit is still not measured. The ramp of 2026-11-23 above repeats this ramp on a cable.

## Ramp, 2026-11-08: broke at 175 phones, with the server nearly idle

| What | Value |
| --- | --- |
| Results file | [`2026-11-08T2008Z-sadiss.net-capacity-server-ramp.json`](../loadtest/results/2026-11-08T2008Z-sadiss.net-capacity-server-ramp.json) |
| Server commit | `d14b3296`; its server code is the same as on `master` after it, which changed only `loadtest/` |
| Target | the capacity instance, `https://sadiss.net/capacity/`, through nginx and TLS; the live instance idle |
| Generator | AMD Ryzen 7 8845HS, 16 threads, Node v22.23.4, on home WiFi (5 GHz) through one home internet line |
| Ramp | 25 phones, 25 more each step; nonChoir track of 30 chunks with 16 partials per frame; every phone joined before the track |
| Last step that passed | 150 phones |
| Broke at | 175 phones |
| What broke first | arrival before sound p1: -1100.56 ms, against at least 500 ms. Every other check passed: no chunk missing, no drop, clock offset p99 0.95 ms, generator event loop p99 0.9 ms |

Per step:

| Phones | Outcome | Arrival p1 | Round trip median | Round trip p99 | Round trip max | Server CPU max | Server memory max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | PASS | 841 ms | 25.4 ms | 55 ms | 212 ms | 6.3% | 126 MB |
| 50 | PASS | 935 ms | 24.3 ms | 66 ms | 173 ms | 1.6% | 113 MB |
| 75 | PASS | 872 ms | 24.2 ms | 110 ms | 495 ms | 2.2% | 115 MB |
| 100 | PASS | 816 ms | 24.8 ms | 122 ms | 301 ms | 2.6% | 121 MB |
| 125 | PASS | 720 ms | 24.9 ms | 265 ms | 1034 ms | 5.5% | 125 MB |
| 150 | PASS | 880 ms | 24.9 ms | 252 ms | 495 ms | 4.0% | 127 MB |
| 175 | FAIL | -1101 ms | 26.4 ms | 1602 ms | 3558 ms | 3.6% | 130 MB |

Server CPU is the share of one core; the box's load stayed at or below 0.17 in every step.

### What this says, and what it does not

Measured: at 175 phones the median chunk still arrived 924 ms before its sound, but a few chunks arrived up to 2.8 s after it (minimum lead -2772 ms), and the slowest clock round trips took up to 3.6 s. In the same step the server's process used at most 3.6% of one core, and the generator's own event loop never fell behind by more than 1 ms.

Inferred, not shown: the delay was not in the server's process, which was nearly idle, nor in the generator's event loop. What is left is the path between them: the generator's WiFi and home internet line, the internet in between, and nginx on the box. Occasional multi-second delays on a few messages, with the median unchanged, look like packets lost and sent again on that path rather than a busy server. This run cannot tell which part of the path it was.

So 175 phones is where this setup broke, not where the server does. The server's own limit is above 175 phones and has not been measured. The ramp of 2026-11-23 above ran from a wired line and broke at the same step, so only a generator near the box is left to separate the two.
