# Load test results

What load tests against the capacity instance found. How to run them is in [`loadtest/README.md`](../loadtest/README.md); each run's figures are in its results file in [`loadtest/results/`](../loadtest/results/).

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

The ramp of 2026-11-08 repeated with the same server, generator and network, to see whether 175 phones repeats.

| What | Value |
| --- | --- |
| Results file | [`2026-11-10T1737Z-sadiss.net-capacity-server-ramp.json`](../loadtest/results/2026-11-10T1737Z-sadiss.net-capacity-server-ramp.json) |
| Server commit | `d14b3296`, as on 2026-11-08 |
| Target, generator, ramp | as on 2026-11-08: the capacity instance through nginx and TLS with the live instance idle, the same laptop on home WiFi, 25 phones and 25 more each step |
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

Measured: the step that broke was 175 phones on 2026-11-08 and 125 today, with the same server and setup. Both times the median round trip stayed at 24 to 26 ms while the p99 jumped past 1.5 s, a few chunks arrived seconds late, and the server's process used under 4% of one core. At 75 phones today a smaller burst of slow round trips (p99 251 ms) passed the thresholds.

Inferred, not shown: a limit that moves by 50 phones between two runs of the same setup, with an idle server, is the path between generator and box, not the server. The server's own limit is still not measured. The laptop has no wired line to the internet, so the wired run waits for a cable to the router; a generator near the box would also take the home line out of the path.

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

So 175 phones is where this setup broke, not where the server does. The server's own limit is above 175 phones and has not been measured. A ramp from a generator on a wired line, or on a machine near the box, would separate the two.
