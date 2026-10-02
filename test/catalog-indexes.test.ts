import assert from "node:assert/strict";
import { test } from "node:test";
import { InfluxReader } from "../src/influx/influx-reader.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { CardCatalog, type ProductRecord, type TrendRecord } from "../src/web/card-catalog.ts";
import { CatalogIndexes } from "../src/web/catalog-indexes.ts";

/** Fake catalog whose products change and can fail; counts the loads. */
class FakeCatalog extends CardCatalog {
  loads = 0;
  failing = false;
  name = "Sol Ring";

  constructor() {
    super(new InfluxReader({ url: "http://influx.invalid", database: "cardmarket", token: "test" }));
  }

  override async products(): Promise<ProductRecord[]> {
    this.loads++;
    if (this.failing) throw new Error("InfluxDB is down");
    return [{ product: "1", name: this.name, category: "Magic Single", expansionId: 1, added: null }];
  }

  override async latestTrends(): Promise<TrendRecord[]> {
    return [];
  }
}

test("builds once, rebuilds in the background after an hour, keeps the old index on failure", async () => {
  const catalog = new FakeCatalog();
  let now = 0;
  const indexes = new CatalogIndexes(catalog, LoggerFactory.silent(), () => now);
  const first = await indexes.get("1");
  assert.equal(await indexes.get("1"), first);
  assert.equal(catalog.loads, 1);

  now = CatalogIndexes.maxAgeMs + 1;
  catalog.name = "Black Lotus";
  assert.equal(await indexes.get("1"), first, "the old index answers while the new one builds");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await indexes.get("1")).card("1")?.name, "Black Lotus");

  now += CatalogIndexes.maxAgeMs + 1;
  catalog.failing = true;
  const kept = await indexes.get("1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await indexes.get("1"), kept);
});

test("retries a failed first build", async () => {
  const catalog = new FakeCatalog();
  catalog.failing = true;
  const indexes = new CatalogIndexes(catalog, LoggerFactory.silent());
  await assert.rejects(indexes.get("1"));
  catalog.failing = false;
  assert.equal((await indexes.get("1")).size, 1);
});
