# tcg-collector

Collects Cardmarket's public files for every game, every day, and imports the catalogues and price guides into InfluxDB:

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
  import-ledger.json                      last day imported into InfluxDB, per file
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
INFLUX_TOKEN=apiv3_... node src/cli.ts --influx-url http://localhost:8181 import --games 1,21
node src/cli.ts --help
```

Global options: `--data-dir` (default `data`), `--base-url`, `--influx-url`, `--influx-database` (default `cardmarket`), `--log-level` (`error`, `warn`, `info`, `debug`; default `info`), `--log-format` (`text` or `json`; default `text`). Equivalent environment variables: `DATA_DIR`, `CARDMARKET_BASE_URL`, `INFLUX_URL`, `INFLUX_DATABASE`, `LOG_LEVEL`, `LOG_FORMAT`, `GAMES`, `IMPORT_GAMES`, `COLLECT_AT`. The InfluxDB token only comes from `INFLUX_TOKEN`, so it never shows in a command line.

Logs go through [Winston](https://github.com/winstonjs/winston) to the console: `info` shows archived files and the summary of each collection, `warn` a file that failed, `debug` also the unchanged and absent files. `--log-format json` writes one JSON object per line, for a log collector.

The default time, 12:00 UTC, comes from the publication times observed on 2026-09-29: price guide around 01:00 UTC, catalogues around 11:30 UTC.

## InfluxDB

`import` writes the archived catalogues and price guides into InfluxDB 3 Core through the official client ([`@influxdata/influxdb3-client`](https://github.com/InfluxCommunity/influxdb3-js)). The database is created by the first write. It only imports the days after the last one recorded in `data/import-ledger.json`, so it can run after every collection; the first run imports the whole archive. `--replay` imports everything again, e.g. into a new database: it creates no duplicates, since InfluxDB keeps one row per series (tag set) and time.

With `INFLUX_URL` set, `schedule` imports after each collection, for the games in `IMPORT_GAMES` (default: the collected games).

Two tables, both tagged with `game` (Cardmarket game id) and `product` (idProduct):

| table | one point per | time | fields |
|---|---|---|---|
| `price` | product and archived price guide | the archive day, 00:00 UTC (the price guide is published around 01:00 UTC that day) | `low`, `trend`, `avg`, `avg1`, `avg7`, `avg30` and the same with `_foil`, in euros; a value Cardmarket leaves empty is not written |
| `product` | new or changed product in an archived catalogue (singles and non-singles) | the catalogue archive day, 00:00 UTC | `name`, `category` (e.g. "Magic Single"), `date_added`, `id_category`, `id_expansion`, `id_metacard` |

The first import of a catalogue writes every product; later ones only write the products that were added or changed, so the latest point of a product is its current description. A price guide is only archived when its content changes, so a missing day means the prices did not move: fill gaps with the previous value, as in the example below.

Example (SQL), daily trend of a card over 90 days with its current name, days without an archive filled with the previous value:

```sql
WITH p AS (SELECT DISTINCT ON (product) product, name FROM product ORDER BY product, time DESC)
SELECT date_bin_gapfill(INTERVAL '1 day', price.time) AS day,
       locf(last_value(price.trend ORDER BY price.time)) AS trend, p.name
FROM price JOIN p ON price.product = p.product
WHERE price.product = '757434' AND price.time >= now() - INTERVAL '90 days' AND price.time < now()
GROUP BY 1, p.name ORDER BY 1
```

```
curl -G http://localhost:8181/api/v3/query_sql -H "Authorization: Bearer $INFLUX_TOKEN" \
  --data-urlencode db=cardmarket --data-urlencode format=pretty --data-urlencode "q=SELECT ..."
```

## Docker

The CI builds the image and publishes it to `ghcr.io/4thlabs/tcg-collector` (tags `latest` and `sha-<commit>`) on every commit to `main`.

`compose.yaml` runs the collector and an InfluxDB 3 Core (HTTP API on port 8181, Parquet files in `./influxdb`). Before the first start, copy `.env.example` to `.env` and set the admin token in `TCG_COLLECTOR_INFLUX_TOKEN` (passed to both containers as `INFLUX_TOKEN`): InfluxDB loads it on its first start, the collector uses it to write, Grafana can use it to read. Settings in the compose file, tuned for one write a day:

- `INFLUXDB3_WAL_FILES_PER_SNAPSHOT=10`: the day's points are persisted to Parquet right after the import, instead of staying in memory for weeks (by default, until 600 write requests).
- `INFLUXDB3_QUERY_FILE_LIMIT=10000`: Core does not compact, so each day of prices is its own Parquet file and a query over N days reads N files; the default limit would reject queries over long periods.

Measured with one simulated month of Magic + Star Wars Unlimited (3.9 million points): 94 MB of Parquet, and about 8 s to import a Magic day.

To use an existing InfluxDB 3 instead, remove the `tcg-collector-influxdb` service and point `INFLUX_URL` at it; to only collect, remove `INFLUX_URL`.

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
src/import/influx-importer.ts        import of the new catalogues and price guides, day by day
src/import/price-point-factory.ts    price guide line -> InfluxDB point
src/import/product-point-factory.ts  catalogue line -> InfluxDB point, change detection
src/import/import-ledger.ts          last imported day per file
src/influx/influx-writer.ts          batched writes through the official InfluxDB 3 client
src/logging/logger-factory.ts        Winston loggers (text or JSON)
```

Tests: `npm test`. Typecheck: `npm run typecheck`.
