# Load test

Virtual phones that connect to a SADISS server the way the app does, play a generated track and report what they received. They import the app's own clock and socket code (`app/src/composables`), so they measure their clock offset exactly as a phone does; they play no sound.

## What a run reports

- **Arrival before sound:** how long before its first sound each chunk reached each phone, by that phone's own estimate of the server clock. The server sends a chunk about one second ahead, so a healthy run reads a little under 1000 ms; a negative value means the chunk came too late to play on time.
- **Clock offset spread:** every second while the track plays, the distance between the highest and the lowest clock offset of all phones. All virtual phones of a run share one physical clock, so a perfect clock sync would give them identical offsets, and the spread is the sync's error.
- **Measurement round trip**, **missing chunks** (counted per phone), **chunks before a clock** (received before the phone had any clock estimate), and **connects / drops**.
- **Generator event loop:** how far the load generator's own event loop fell behind. When this is high, the generator, not the server, was the bottleneck.

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

Options, with their defaults: `--api http://127.0.0.1:3000`, `--ws ws://127.0.0.1:8080`, `--phones 10`, `--seconds 30` (track length), `--partials 16` (partials per frame, which sets the size of every chunk), `--join-over 5` (seconds over which the phones join) and `--settle 10` (seconds the phones measure their clocks before the track starts).

Each run uploads its own track into a new performance, named `loadtest` with the time of the run.

## Tests

```sh
npm test
npm run typecheck
```
