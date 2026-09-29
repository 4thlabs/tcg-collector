import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PriceGuideEntry, ProductEntry } from "../src/cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../src/cardmarket/feed-file.ts";
import { GameSelection } from "../src/collect/game-selection.ts";
import type { Price, Product } from "../src/database/entities.ts";
import { PriceImporter, type PriceStore } from "../src/import/price-importer.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { SnapshotArchive } from "../src/storage/snapshot-archive.ts";

/** Fake database: keeps the saved days, prices and products in memory. */
class FakeStore implements PriceStore {
  readonly saved: { feed: string; day: string; prices: readonly Price[]; products?: readonly Product[] }[] = [];

  async importedDays(feed: string): Promise<Set<string>> {
    return new Set(this.saved.filter((entry) => entry.feed === feed).map((entry) => entry.day));
  }

  async saveDay(feed: string, day: string, prices: readonly Price[], products?: readonly Product[]): Promise<void> {
    this.saved.push({ feed, day, prices, products });
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
  const store = new FakeStore();
  const storePrices = (day: string, entries: PriceGuideEntry[]) =>
    archive.store(new FeedFile(FeedKind.priceGuide, 21), day, Buffer.from(JSON.stringify({ version: 1, createdAt: day, priceGuides: entries })));
  const storeCatalogue = (day: string, products: ProductEntry[]) =>
    archive.store(new FeedFile(FeedKind.singles, 21), day, Buffer.from(JSON.stringify({ version: 1, createdAt: day, products })));
  const run = (replay = false) => new PriceImporter(archive, store, LoggerFactory.silent()).import(GameSelection.parse("1,21"), replay);
  return { store, storePrices, storeCatalogue, run };
}

test("imports each archived day; products go with the first day and when the catalogue changes", async () => {
  const { store, storePrices, storeCatalogue, run } = await setup();
  await storeCatalogue("2026-09-28", [product(1, "Krennic")]);
  await storeCatalogue("2026-09-30", [product(1, "Director Krennic")]);
  await storePrices("2026-09-29", [{ idProduct: 1, idCategory: 1644, low: 2, trend: 2.5, "trend-foil": null }]);
  await storePrices("2026-09-30", [{ idProduct: 1, idCategory: 1644, low: 3 }]);
  await storePrices("2026-10-01", [{ idProduct: 1, idCategory: 1644, low: 4 }]);

  assert.deepEqual(await run(), { files: 3, rows: 3 });
  assert.deepEqual(
    store.saved.map((entry) => [entry.day, entry.products?.map((p) => p.name)]),
    [
      ["2026-09-29", ["Krennic"]],
      ["2026-09-30", ["Director Krennic"]],
      ["2026-10-01", undefined],
    ],
  );
  assert.deepEqual(store.saved[0]?.prices[0], {
    day: "2026-09-29", idProduct: 1, game: 21, low: 2, trend: 2.5, avg: null, avg1: null, avg7: null, avg30: null,
    lowFoil: null, trendFoil: null, avgFoil: null, avg1Foil: null, avg7Foil: null, avg30Foil: null,
  });
});

test("only imports the days not imported yet, unless replaying", async () => {
  const { storePrices, run } = await setup();
  await storePrices("2026-09-29", [{ idProduct: 1, idCategory: 1644, low: 2 }]);
  await run();
  await storePrices("2026-09-30", [{ idProduct: 1, idCategory: 1644, low: 3 }]);

  assert.deepEqual(await run(), { files: 1, rows: 1 });
  assert.deepEqual(await run(), { files: 0, rows: 0 });
  assert.deepEqual(await run(true), { files: 2, rows: 2 });
});

test("skips products without any price", async () => {
  const { store, storePrices, run } = await setup();
  await storePrices("2026-09-29", [
    { idProduct: 1, idCategory: 1644, low: null, trend: null },
    { idProduct: 2, idCategory: 1644, avg1: 0.5 },
  ]);
  await run();
  assert.deepEqual(store.saved[0]?.prices.map((price) => price.idProduct), [2]);
});
