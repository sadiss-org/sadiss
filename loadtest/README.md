# Load test

Virtual phones that connect to a SADISS server the way the app does, play a generated track and report what they received. They connect through the app's own device connection and clock sync (`app/src/composables/deviceConnection.ts` and `clockSync.ts`), so they register, keep time and reconnect exactly as a phone does; they play no sound.

## What a run reports

- **Arrival before sound:** how long before its first sound each chunk reached each phone, by that phone's own estimate of the server clock. The server sends a chunk about one second ahead, so a healthy run reads a little under 1000 ms; a negative value means the chunk came too late to play on time.
- **Clock offset off the median:** every second while the track plays, how far each phone's clock offset is from the median offset of all phones. All virtual phones of a run share one physical clock, so a perfect clock sync would give them identical offsets, and each distance is that phone's share of the sync's error. This holds only for virtual phones: real phones have clocks of their own, so their offsets differ for that reason alone.
- **Round trips at track start:** how many clock measurements each phone had completed when the track started. The app's clock estimate uses the last 20, one every 3 s, so it is settled about a minute after a phone joins.
- **Measurement round trip** (every clock measurement from joining to the end of the track), **missing chunks** (counted per phone), **chunks before a clock** (received before the phone had any clock estimate), and **connects** (every connection the phones opened, from joining to the end of the track).
- **Drops during the track** and **drops before the track:** how often a phone lost a live connection from the start of the track until it was stopped (including the few seconds after the last chunk in which late chunks may still arrive), and before it started, while the phones joined and settled.
- **Generator event loop:** how far the load generator's own event loop fell behind while the track played. When this is high, the generator, not the server, was the bottleneck, and the run is invalid (see below).

A run that cannot connect any phone stops with an error instead of reporting a clean run.

## Pass, fail or invalid

After the figures, a run checks each threshold in [`src/thresholds.ts`](src/thresholds.ts) and prints one line per check, with the measured value, the limit and whether it passed. A value equal to its limit passes. Then it prints the outcome: PASS, FAIL or INVALID.

- **Arrival before sound p1:** the 1st percentile of how long before its sound each chunk arrived. When it is at least the limit, 99% of chunks arrived at least that long before they had to sound. Chunks that reached a phone before it had a clock are not in this figure; they are printed as a count and have no threshold.
- **Missing chunks** and **drops during the track:** every phone receives every chunk, and no phone loses its connection from the start of the track until it is stopped. Drops before the track are printed as a count and have no threshold.
- **Clock offset off the median p99:** 99% of the sampled offsets are that close to the median of all phones.
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

Options, with their defaults: `--api http://127.0.0.1:3000`, `--ws ws://127.0.0.1:8080`, `--phones 10`, `--seconds 30` (track length), `--partials 16` (partials per frame; in nonChoir mode the server shares them out over the phones, at most 16 each), `--join-over 5` (seconds over which the phones join) and `--settle 60` (seconds the phones measure their clocks before the track starts). A value that is not a number is refused, and so is `--phones` below 2, since the offset from the median needs at least two phones (`MIN_PHONES` in [`src/stats.ts`](src/stats.ts)).

Each run uploads its own track into a new performance, named `loadtest` with the time of the run.

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

The paths and ports are set in [`capacity/config.sh`](capacity/config.sh); [`capacity/nginx.conf`](capacity/nginx.conf) repeats the ports.

Once, to set it up:

```sh
loadtest/capacity/setup.sh               # folders, secrets, MongoDB user and .env on the box
loadtest/capacity/deploy.sh HEAD         # build and start the server
loadtest/capacity/install-nginx.sh       # add its nginx routes, reload nginx, run the smoke test
```

To test another commit, `loadtest/capacity/deploy.sh <commit>` builds the server at that commit on this machine, installs it on the capacity instance with that commit's dependencies and restarts only that instance.

A run, with the admin login read from the box:

```sh
cd loadtest
eval "$(ssh root@sadiss.net "sed -n 's/^ADMIN_/export SADISS_ADMIN_/p' /root/.sadiss-capacity")"
npm run loadtest -- --api https://sadiss.net/capacity/server --ws wss://sadiss.net/capacity/ws/ --phones 100
```

To remove it, on the box:

```sh
rm /etc/nginx/forge-conf/sadiss.org/server/capacity.conf && nginx -t && systemctl reload nginx && /opt/smoke.sh
pm2 delete sadiss-capacity && pm2 save
mongosh -u admin -p --authenticationDatabase admin sadiss_capacity --eval 'db.dropUser("capacity"); db.dropDatabase()'
rm -r /opt/sadiss-capacity /mnt/HC_Volume_33896583/capacity /root/.sadiss-capacity
```

## Tests

```sh
npm test
npm run typecheck
```
