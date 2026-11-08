# Load test

Virtual phones that connect to a SADISS server the way the app does, play a generated track and report what they received. They connect through the app's own device connection and clock sync (`app/src/composables/deviceConnection.ts` and `clockSync.ts`), so they register, keep time and reconnect exactly as a phone does; they play no sound.

## The room

The phones join the way a room fills up. Most join one after another over `--join-over` seconds before the track and measure their clocks for `--settle` seconds; the rest, a share set by `--late-share`, join one after another over the first half of the track. A phone that joins during the track is expected to receive every chunk from the one after the next chunk the server sends once its connection went live: that next one may race the phone's registration.

With `--voices`, the track is in choir mode: each partial is one voice, and a phone plays the partial whose index is its choir id. The admin prints one QR code per voice and people take whichever is in front of them, so choir ids go round over the voices in join order. With `--langs`, every voice has a phrase every `--phrase-every` seconds in each language (in nonChoir mode only voice 0, which the server reads to every phone), and the phones' languages go round once per round of voices, so every voice is heard in every language. Each phrase's text names its voice, language and time, so a phone can tell when it was sent the wrong one. Without `--langs` a phone sends no language, as the app does when its QR code offers none.

## What a run reports

- **Arrival before sound:** how long before its first sound each chunk reached each phone, by that phone's own estimate of the server clock. The server sends a chunk about one second ahead, so a healthy run reads a little under 1000 ms; a negative value means the chunk came too late to play on time.
- **Clock offset off the median:** every second while the track plays, how far the clock offset of each phone that joined before the track is from the median offset of those phones. All virtual phones of a run share one physical clock, so a perfect clock sync would give them identical offsets, and each distance is that phone's share of the sync's error. This holds only for virtual phones: real phones have clocks of their own, so their offsets differ for that reason alone.
- **Late phones off the median:** the same for each phone that joined during the track, measured against the median of the phones that joined before it. A late phone's clock has had few round trips, and with one round trip its offset can be off by up to half that round trip, so this figure has no threshold.
- **Phrase before its time,** **missing phrases** (phrases of a phone's voice it never received, counted per phone and, for a late phone, as for its chunks), **wrong phrases** (received with the text of another voice or language, without a text, or at a time its voice has none) and **phrases before a clock:** printed only for a track with phrases.
- **Round trips at track start:** how many clock measurements each phone that joined before the track had completed when the track started. The app's clock estimate uses the last 20, one every 3 s, so it is settled about a minute after a phone joins.
- **Measurement round trip** (every clock measurement from joining to the end of the track), **missing chunks** (counted per phone), **chunks before a clock** (received before the phone had any clock estimate), and **connects** (every connection the phones opened, from joining to the end of the track).
- **Drops during the track** and **drops before the track:** how often a phone lost a live connection from the start of the track until it was stopped (including the few seconds after the last chunk in which late chunks may still arrive), and before it started, while the phones joined and settled.
- **Generator event loop:** how far the load generator's own event loop fell behind while the track played. When this is high, the generator, not the server, was the bottleneck, and the run is invalid (see below).

A run that cannot connect any phone stops with an error instead of reporting a clean run.

## Pass, fail or invalid

After the figures, a run checks each threshold in [`src/thresholds.ts`](src/thresholds.ts) and prints one line per check, with the measured value, the limit and whether it passed. A value equal to its limit passes. Then it prints the outcome: PASS, FAIL or INVALID.

- **Arrival before sound p1:** the 1st percentile of how long before its sound each chunk arrived. When it is at least the limit, 99% of chunks arrived at least that long before they had to sound. Chunks that reached a phone before it had a clock are not in this figure; they are printed as a count and have no threshold.
- **Missing chunks** and **drops during the track:** every phone receives every chunk (a late phone from the chunk the room section above names), and no phone loses its connection from the start of the track until it is stopped. Drops before the track are printed as a count and have no threshold.
- **Clock offset off the median p99:** 99% of the sampled offsets of the phones that joined before the track are that close to their median.
- For a track with phrases, phrases are held to the same rules as chunks: **phrase before its time p1** at least the same limit, and no **missing phrases** or **wrong phrases**.
- **Generator event loop p99:** the load generator kept up. When its own event loop fell behind by more than the limit, the generator could not have read or answered the server on time, so a late chunk or a slow clock answer might be its own fault. The run is then INVALID, whatever the other checks say, and should be repeated with a faster laptop or fewer phones. The checks are still printed.

A check whose figure has no value, such as no chunk arriving at a phone that had a clock, fails and prints `-`.

The exit code follows the outcome:

| Exit code | Meaning |
| --- | --- |
| 0 | PASS: every threshold was met. |
| 1 | The load test itself crashed, such as when no phone could connect or the server stopped answering the admin API before the track ended. A server that stops answering during the track fails the run instead: stopping the track at the end only prints a warning when it fails. |
| 2 | Usage error: missing credentials or an option that is refused. |
| 3 | FAIL: the server missed at least one threshold. |
| 4 | INVALID: the load test itself could not measure the server, such as when the load generator fell behind. The outcome line says which. |

## Running against a local server

The server needs a MongoDB with an admin account. With Docker:

```sh
docker run -d --name sadiss-loadtest-mongo -p 127.0.0.1:27018:27017 mongo:8.2

cd server
export USE_IN_MEMORY_DB=false MONGO_URL=mongodb://127.0.0.1:27018/sadiss_loadtest
ADMIN_EMAIL=loadtest@example.invalid ADMIN_PASSWORD=<choose one> npx ts-node --transpile-only scripts/createAdmin.ts
npx ts-node --transpile-only server.ts
```

In another terminal:

```sh
cd loadtest
npm install
SADISS_ADMIN_EMAIL=loadtest@example.invalid SADISS_ADMIN_PASSWORD=<the same> npm run loadtest -- --phones 10 --seconds 30
```

Options, with their defaults: `--api http://127.0.0.1:3000`, `--ws ws://127.0.0.1:8080`, `--phones 10`, `--seconds 30` (track length), `--partials 16` (partials per frame; in nonChoir mode the server shares them out over the phones, at most 16 each), `--voices` (choir mode with this many voices, one partial each; not together with `--partials`), `--langs` (phrases in these ISO codes, separated by commas, such as `en-US,de-DE`), `--phrase-every 4` (seconds between a voice's phrases, at least 1, since the server keeps one phrase per voice and chunk), `--join-over 5` (seconds over which the phones that join before the track do so), `--late-share 0.1` (the share of phones that join during the first half of the track), `--settle 60` (seconds the phones measure their clocks before the track starts), `--server-commit` (the commit the server under test runs, when it cannot be found; see below) and `--note` (a few words kept with the run, such as what else ran on the box). A value that is not a number is refused, and so is `--phones` below 2, or a late share that leaves fewer than 2 phones joining before the track, since the offset from the median needs at least two phones (`MIN_PHONES` in [`src/stats.ts`](src/stats.ts)).

A choir run with phrases:

```sh
npm run loadtest -- --phones 20 --voices 4 --langs en-US,de-DE --phrase-every 3 --late-share 0.2
```

Each run uploads its own track into a new performance, named `loadtest` with the time of the run.

## Results files and comparing runs

Every run that reaches a verdict keeps a results file in [`results/`](results/), named by when it started (UTC), the target and the number of phones, such as `2026-11-08T1930Z-sadiss.net-capacity-server-100p.json`. It holds the commit of the server under test, the commit of the load test, the target, the time, the machine the generator ran on, the note, every figure and the verdict, with the figures named as the summary names them ([`src/figures.ts`](src/figures.ts)). Commit the files of runs worth keeping.

The server does not report its commit, so the run finds it: for the capacity instance, the first line of its `DEPLOYED.txt` over ssh, with a warning when that deploy did not finish; for a server on this machine, this checkout's commit, with `-dirty` when `server/` has uncommitted changes. For any other server, or when that fails, the run warns and keeps the commit as unknown unless `--server-commit` gives it.

To put runs side by side, the first as the baseline:

```sh
npm run compare -- results/2026-11-08-sadiss.net-capacity-server-100p.json results/<a later run>.json
```

A value of a later run is marked WORSE when it is further from good than the baseline's: a time by more than 10% of the baseline's value and by more than 5 ms, so noise on a value near zero is not a regression; a count, such as missing chunks or drops, by any amount. A value either run did not measure is never marked. When the runs differ in phones, track or target, a note says so, since their figures then need not match. The margins and the figures compared are in [`src/compare.ts`](src/compare.ts).

## Running against the capacity instance

The capacity instance is a second SADISS server on the production box, reached through the same nginx and TLS as the live one, at `https://sadiss.net/capacity/`, so that any commit can be measured without touching the live instance. It shares the box's Node, MongoDB and nginx with the live one and nothing else. A run there loads the box the live instance runs on, so **never run one while a performance is live**.

| What | Where |
| --- | --- |
| Server (`dist/`, `node_modules`, `.env`; no git checkout) | `/opt/sadiss-capacity/server` |
| The commit it runs | `/opt/sadiss-capacity/DEPLOYED.txt` |
| PM2 app | `sadiss-capacity`, ports 3006 (HTTP) and 40001 (WebSockets) |
| MongoDB | database `sadiss_capacity`, user `capacity` with readWrite on it only |
| Uploads and chunks | `/mnt/HC_Volume_33896583/capacity/` |
| Secrets: database password, session and JWT secrets, the load test's admin login | `/root/.sadiss-capacity`, mode 600 |
| nginx routes `/capacity/server/` and `/capacity/ws/` | `/etc/nginx/forge-conf/sadiss.org/server/capacity.conf`, included by the `sadiss.org` server block |

The paths and ports are set in [`capacity/config.sh`](capacity/config.sh); `install-nginx.sh` fills the ports into [`capacity/nginx.conf`](capacity/nginx.conf).

Once, to set it up:

```sh
loadtest/capacity/setup.sh               # folders, secrets, MongoDB user and .env on the box
loadtest/capacity/deploy.sh HEAD         # build and start the server
loadtest/capacity/install-nginx.sh       # add its nginx routes, reload nginx, run the smoke test
```

To test another commit, `loadtest/capacity/deploy.sh <commit>` builds the server at that commit on this machine, installs it on the capacity instance with that commit's dependencies and restarts only that instance. The first deploy needs a commit from c0884dd6 on, which brings the script that creates the load test's admin login; later deploys of older commits use the login that one created. `DEPLOYED.txt` names the commit and has a line for each step that finished (copied, installed, answered), so a deploy that stopped part-way shows where.

A run, with the admin login read from the box:

```sh
cd loadtest
eval "$(ssh root@sadiss.net "sed -n 's/^ADMIN_/export SADISS_ADMIN_/p' /root/.sadiss-capacity")"
npm run loadtest -- --api https://sadiss.net/capacity/server --ws wss://sadiss.net/capacity/ws/ --phones 100
```

To remove it: `loadtest/capacity/remove.sh`. It asks first, then deletes the nginx routes, the PM2 app, the database and its user, the folders, the data and the secrets.

## Tests

```sh
npm test
npm run typecheck
```
