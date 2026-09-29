# tcg-collector

Collects Cardmarket's public files for every game, every day:

| File | Content | Size (Magic) |
|---|---|---|
| `price_guide_N.json` | today's prices (low, trend, avg1/7/30, foil versions) | 26 MB |
| `products_singles_N.json` | single-card catalogue | 20 MB |
| `products_nonsingles_N.json` | catalogue of other products (boosters, boxes…) | 1 MB |

`N` is Cardmarket's game id (1 = Magic, 21 = Star Wars Unlimited). As of 2026-09-29, 22 games publish files (1 to 25, except 4 and 14): 165 MB in total, 17 MB once compressed.

## What gets archived

For each file, on every collection:

1. **HEAD request**: if the ETag is the same as last time, the file was not regenerated. Nothing is downloaded.
2. Otherwise, download and compute a **SHA-256 fingerprint of the content without the `createdAt` field** (Cardmarket changes it on every regeneration, even when no data moved).
3. If the fingerprint matches the last archive, nothing is written. Otherwise, the raw file is archived as gzip.

Catalogues are therefore archived only when they really change. Estimated storage: under 7 GB per year for every game.

```
data/
  ledger.json                             last version seen for each file (ETag, fingerprint, dates)
  archive/<type>/<game>/<YYYY-MM-DD>.json.gz
```

To read an archive: `gunzip -c data/archive/price_guide/21/2026-09-29.json.gz | jq .`

## Usage

Node 22.18 or later (runs TypeScript directly).

```
npm install
node src/cli.ts games                  # available games and file sizes
node src/cli.ts collect                # one collection, every game
node src/cli.ts collect --games 1,21   # Magic and Star Wars Unlimited only
node src/cli.ts schedule --at 12:00    # collect every day at 12:00 UTC, without stopping
node src/cli.ts --help
```

Global options: `--data-dir` (default `data`), `--base-url`. Equivalent environment variables: `DATA_DIR`, `CARDMARKET_BASE_URL`, `GAMES`, `COLLECT_AT`.

The default time, 12:00 UTC, comes from the publication times observed on 2026-09-29: price guide around 01:00 UTC, catalogues around 11:30 UTC.

## Docker

The CI builds the image and publishes it to `ghcr.io/4thlabs/tcg-collector` (tags `latest` and `sha-<commit>`) on every commit to `main`.

```
docker compose pull && docker compose up -d   # published image
docker compose up -d --build                  # or build locally
docker compose logs -f
```

If the ghcr.io package is private, log in first: `docker login ghcr.io` (GitHub token with the `read:packages` scope).

The container collects on start, then every day at `COLLECT_AT` (UTC), and restarts on its own. Archives are in `./data` on the host. Restarting the container creates no duplicates: the ledger skips files already archived.

## CI

`.github/workflows/ci.yml`, on every PR and every commit to `main`:

1. typecheck and tests, on Node 22.18 and 24;
2. Docker image build, and a check that the CLI starts in it;
3. on `main` only: publication of the image to ghcr.io.

## Code

```
src/cli.ts                           Commander entry point
src/app.ts                           dependency wiring
src/commands/                        one class per command (collect, schedule, games)
src/cardmarket/feed-file.ts          file types and server paths
src/cardmarket/cardmarket-client.ts  HEAD / GET through ky (retries, timeout)
src/storage/content-fingerprint.ts   fingerprint without createdAt
src/storage/fingerprint-ledger.ts    JSON ledger (atomic writes)
src/storage/snapshot-archive.ts      gzip archives
src/collect/collector.ts             collection and deduplication logic
src/collect/daily-scheduler.ts       daily run at a fixed time
```

Tests: `npm test`. Typecheck: `npm run typecheck`.
