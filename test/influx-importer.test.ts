import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PriceGuideEntry, ProductEntry } from "../src/cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../src/cardmarket/feed-file.ts";
import { GameSelection } from "../src/collect/game-selection.ts";
import { ImportLedger } from "../src/import/import-ledger.ts";
import { InfluxImporter } from "../src/import/influx-importer.ts";
import { InfluxWriter } from "../src/influx/influx-writer.ts";
import type { LinePoint } from "../src/influx/line-point.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { SnapshotArchive } from "../src/storage/snapshot-archive.ts";

/** Fake InfluxDB: keeps the written lines. */
class FakeWriter extends InfluxWriter {
  lines: string[] = [];

  constructor() {
    super({ url: "http://influx.invalid", org: "tcg", bucket: "cardmarket", token: "test" });
  }

  override async write(points: readonly LinePoint[]): Promise<number> {
    this.lines.push(...points.map((point) => point.toLine()));
    return points.length;
  }
}

const product = (idProduct: number, name: string): ProductEntry => ({
  idProduct,
  name,
  idCategory: 1644,
  categoryName: "Star Wars Unlimited Single",
  idExpansion: 5618,
  idMetacard: 0,
  dateAdded: "2024-01-31 14:18:29",
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "importer-"));
  const archive = new SnapshotArchive(join(dir, "archive"));
  const writer = new FakeWriter();
  const storePrices = (day: string, entries: PriceGuideEntry[]) =>
    archive.store(new FeedFile(FeedKind.priceGuide, 21), day, Buffer.from(JSON.stringify({ version: 1, createdAt: day, priceGuides: entries })));
  const storeCatalogue = (day: string, products: ProductEntry[]) =>
    archive.store(new FeedFile(FeedKind.singles, 21), day, Buffer.from(JSON.stringify({ version: 1, createdAt: day, products })));
  const run = async (replay = false) => {
    const importer = new InfluxImporter(archive, await ImportLedger.open(join(dir, "import-ledger.json")), writer, LoggerFactory.silent());
    return importer.import(GameSelection.parse("1,21"), replay);
  };
  return { writer, storePrices, storeCatalogue, run };
}

test("imports each archived day with the catalogue in force that day", async () => {
  const { writer, storePrices, storeCatalogue, run } = await setup();
  await storeCatalogue("2026-09-28", [product(1, "Krennic")]);
  await storeCatalogue("2026-09-30", [product(1, "Director Krennic")]);
  await storePrices("2026-09-29", [{ idProduct: 1, idCategory: 1644, low: 2, trend: 2.5, "trend-foil": null }]);
  await storePrices("2026-09-30", [{ idProduct: 1, idCategory: 1644, low: 3 }]);

  const summary = await run();
  assert.deepEqual(summary, { files: 2, points: 2 });
  assert.deepEqual(writer.lines, [
    "price,category=Star\\ Wars\\ Unlimited\\ Single,expansion=5618,game=21,name=Krennic,product=1 low=2.0,trend=2.5 1790640000",
    "price,category=Star\\ Wars\\ Unlimited\\ Single,expansion=5618,game=21,name=Director\\ Krennic,product=1 low=3.0 1790726400",
  ]);
});

test("only imports the days not imported yet, unless replaying", async () => {
  const { writer, storePrices, run } = await setup();
  await storePrices("2026-09-29", [{ idProduct: 1, idCategory: 1644, low: 2 }]);
  await run();
  await storePrices("2026-09-30", [{ idProduct: 1, idCategory: 1644, low: 3 }]);

  assert.deepEqual(await run(), { files: 1, points: 1 });
  assert.deepEqual(await run(), { files: 0, points: 0 });
  assert.deepEqual(await run(true), { files: 2, points: 2 });
  assert.equal(writer.lines.length, 4);
});

test("skips products without any price; tags only game and product without a catalogue", async () => {
  const { writer, storePrices, run } = await setup();
  await storePrices("2026-09-29", [
    { idProduct: 1, idCategory: 1644, low: null, trend: null },
    { idProduct: 2, idCategory: 1644, avg1: 0.5 },
  ]);
  await run();
  assert.deepEqual(writer.lines, ["price,game=21,product=2 avg1=0.5 1790640000"]);
});
