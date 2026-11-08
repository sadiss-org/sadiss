# Load test results

What load tests against the capacity instance found. How to run them is in [`loadtest/README.md`](../loadtest/README.md); each run's figures are in its results file in [`loadtest/results/`](../loadtest/results/).

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
