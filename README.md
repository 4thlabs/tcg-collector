# tcg-collector

Collects Cardmarket's public files for every game, every day, and imports the price guides into TimescaleDB:

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
DATABASE_URL=postgres://tcg:...@localhost:5432/tcg node src/cli.ts import --games 1,21
node src/cli.ts --help
```

Global options: `--data-dir` (default `data`), `--base-url`, `--log-level` (`error`, `warn`, `info`, `debug`; default `info`), `--log-format` (`text` or `json`; default `text`). Equivalent environment variables: `DATA_DIR`, `CARDMARKET_BASE_URL`, `LOG_LEVEL`, `LOG_FORMAT`, `GAMES`, `IMPORT_GAMES`, `COLLECT_AT`. The database connection only comes from `DATABASE_URL`, so its password never shows in a command line.

Logs go through [Winston](https://github.com/winstonjs/winston) to the console: `info` shows archived files and the summary of each collection, `warn` a file that failed, `debug` also the unchanged and absent files. `--log-format json` writes one JSON object per line, for a log collector.

The default time, 12:00 UTC, comes from the publication times observed on 2026-09-29: price guide around 01:00 UTC, catalogues around 11:30 UTC.

## TimescaleDB

`import` writes the archived price guides into PostgreSQL with [TimescaleDB](https://www.timescale.com/), through [TypeORM](https://typeorm.io/). On connection it applies the pending migrations: the first one creates the tables, then the `price` hypertable and its compression, in plain SQL. Entities are TypeORM entity schemas rather than decorated classes, because Node runs this TypeScript directly and does not support decorators.

The `imported_file` table records each imported day, so `import` only imports the new days and can run after every collection; on an empty database, it imports the whole archive. Each day is saved in one transaction. `--replay` imports everything again: rows are upserted, never duplicated.

With `DATABASE_URL` set, `schedule` imports after each collection, for the games in `IMPORT_GAMES` (default: the collected games).

| Table | Content |
|---|---|
| `price` | hypertable, one row per product and per day: `day`, `id_product`, `game`, then `low`, `trend`, `avg`, `avg1`, `avg7`, `avg30` and the same with `_foil`, in euros (null when Cardmarket leaves it empty) |
| `product` | latest catalogue: `id_product`, `game`, `name`, `category` (e.g. "Magic Single"), `id_expansion`, `id_metacard` |
| `imported_file` | imported price guides: `feed` (e.g. `price_guide_21`), `day`, `rows`, `imported_at` |

`day` is the archive day; the price guide is published around 01:00 UTC that day. Products are written with the first day imported, then whenever the catalogue changes. A price guide is only archived when its content changes, so a missing day means the prices did not move: fill gaps with the previous value, as in the example below.

`price` is split into 7-day chunks, compressed by a TimescaleDB background job once older than 7 days, rows sorted by product then day (a price that does not move costs almost nothing). Measured on simulated Magic + Star Wars Unlimited data (134,000 rows per day): about 3.3 to 3.9 MB per day once compressed, and about 10 s to import a Magic day (batched upserts through TypeORM).

Example, daily trend of a card over 90 days, days without an archive filled with the previous value:

```sql
SELECT time_bucket_gapfill('1 day', day) AS day, locf(last(trend, day)) AS trend, p.name
FROM price JOIN product p USING (id_product)
WHERE id_product = 757434 AND day >= now() - INTERVAL '90 days' AND day < now()
GROUP BY 1, p.name ORDER BY 1;
```

## Docker

The CI builds the image and publishes it to `ghcr.io/4thlabs/tcg-collector` (tags `latest` and `sha-<commit>`) on every commit to `main`.

`compose.yaml` runs the collector and PostgreSQL 17 with TimescaleDB (`timescale/timescaledb` image, port 5432, data in `./timescaledb`). Before the first start, copy `.env.example` to `.env` and set the password of the `tcg` user. The collector waits for the database to be ready, creates the schema on its first import, then fills it from the archive.

To use an existing PostgreSQL with TimescaleDB instead, remove the `timescaledb` service and point `DATABASE_URL` at it; to only collect, remove `DATABASE_URL`.

```
cp .env.example .env                          # then edit it
docker compose pull && docker compose up -d   # published image
docker compose up -d --build                  # or build locally
docker compose logs -f
```

If the ghcr.io package is private, log in first: `docker login ghcr.io` (GitHub token with the `read:packages` scope).

The container collects (and imports) on start, then every day at `COLLECT_AT` (UTC), and restarts on its own. Archives are in `./data` on the host. Restarting the container creates no duplicates: the ledger skips files already archived.

## CI

`.github/workflows/ci.yml`, on every PR and every commit to `main`:

1. typecheck and tests, on Node 22.18 and 24;
2. Docker image build, and a check that the CLI starts in it;
3. on `main` only: publication of the image to ghcr.io.

## Code

```
src/cli.ts                           Commander entry point
src/app.ts                           dependency wiring
src/commands/                        one class per command (collect, schedule, import, games)
src/cardmarket/feed-file.ts          file types and server paths
src/cardmarket/feed-content.ts       content of the price guide and catalogue files
src/cardmarket/cardmarket-client.ts  HEAD / GET through ky (retries, timeout)
src/storage/content-fingerprint.ts   fingerprint without createdAt
src/storage/fingerprint-ledger.ts    JSON ledger (atomic writes)
src/storage/snapshot-archive.ts      gzip archives (write, list, read)
src/collect/collector.ts             collection and deduplication logic
src/collect/daily-scheduler.ts       daily run at a fixed time
src/import/price-importer.ts         import of the new price guides, day by day
src/import/price-row-factory.ts      price guide and catalogue lines -> database rows
src/import/product-catalog.ts        catalogue in force on a given day (names, expansions)
src/database/entities.ts             TypeORM entity schemas (product, price, imported_file)
src/database/create-price-schema.ts  migration: tables, hypertable and compression
src/database/price-database.ts       TypeORM data source, migrations, batched upserts
src/logging/logger-factory.ts        Winston loggers (text or JSON)
```

Tests: `npm test`. Typecheck: `npm run typecheck`.
