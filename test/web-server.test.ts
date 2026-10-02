import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { InfluxReader } from "../src/influx/influx-reader.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { CardCatalog, type CardSummary, type Prices } from "../src/web/card-catalog.ts";
import { WebServer } from "../src/web/web-server.ts";

const card = (product: string, name: string, expansionId: number): CardSummary => ({
  product, name, expansionId, expansion: null, version: null, added: "2026-09-21",
});

/** Fake catalog: records the calls, never reaches InfluxDB. */
class FakeCatalog extends CardCatalog {
  calls: string[] = [];

  constructor() {
    super(new InfluxReader({ url: "http://influx.invalid", database: "cardmarket", token: "test" }));
  }

  override async search(game: string, text: string): Promise<CardSummary[]> {
    this.calls.push(`search ${game} ${text}`);
    return [card("910771", "Sol Ring", 6572)];
  }

  override async latestPrices(game: string, product: string): Promise<Prices | null> {
    this.calls.push(`prices ${game} ${product}`);
    return null;
  }

  override async dailyPrices(game: string, product: string, days: number): Promise<Prices[]> {
    this.calls.push(`daily ${game} ${product} ${days}`);
    throw new Error("InfluxDB is down");
  }
}

const catalog = new FakeCatalog();
const server = new WebServer(catalog, LoggerFactory.silent());
let base = "";

before(async () => {
  base = `http://127.0.0.1:${await server.listen(0, "127.0.0.1")}`;
});
after(() => server.close());

test("serves the page and Chart.js", async () => {
  for (const path of ["/", "/app.js", "/style.css", "/vendor/chart.js"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
});

test("serves nothing else from disk", async () => {
  for (const path of ["/package.json", "/../package.json", "/web/index.html"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    await response.arrayBuffer();
  }
});

test("answers the API from the catalog", async () => {
  const search = (await (await fetch(`${base}/api/search?game=1&q=Sol%20Ring`)).json()) as { cards: CardSummary[] };
  assert.equal(search.cards[0].product, "910771");
  assert.deepEqual(await (await fetch(`${base}/api/prices?game=21&product=903189`)).json(), { prices: null });
  assert.deepEqual(catalog.calls.slice(-2), ["search 1 Sol Ring", "prices 21 903189"]);
});

test("refuses bad parameters before querying", async () => {
  const before = catalog.calls.length;
  for (const query of ["search?game=1&q=ab", "search?game=x&q=Sol", "prices?game=1&product=1'--", "daily?game=1&product=1&days=0"]) {
    const response = await fetch(`${base}/api/${query}`);
    assert.equal(response.status, 400, query);
    await response.arrayBuffer();
  }
  assert.equal(catalog.calls.length, before);
});

test("hides database errors behind a 500", async () => {
  const response = await fetch(`${base}/api/daily?game=1&product=910771&days=30`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "The price database could not answer" });
});
