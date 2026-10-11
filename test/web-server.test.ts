import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { InfluxReader } from "../src/influx/influx-reader.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { CardCatalog, type Prices, type ProductRecord, type TrendRecord } from "../src/web/card-catalog.ts";
import { CardImages } from "../src/web/card-images.ts";
import type { SearchResult } from "../src/web/catalog-index.ts";
import { PoliteHttp } from "../src/web/polite-http.ts";
import { CatalogIndexes } from "../src/web/catalog-indexes.ts";
import { WebServer } from "../src/web/web-server.ts";

/** Fake catalog: two products, records the price calls, never reaches InfluxDB. */
class FakeCatalog extends CardCatalog {
  calls: string[] = [];

  constructor() {
    super(new InfluxReader({ url: "http://influx.invalid", database: "cardmarket", token: "test" }));
  }

  override async products(): Promise<ProductRecord[]> {
    return [
      { product: "910771", name: "Sol Ring", category: "Magic Single", expansionId: 6572, added: "2026-09-21" },
      {
        product: "1",
        name: "Commander: Foundations Display",
        category: "Magic Display",
        expansionId: 6572,
        added: "2026-09-21",
      },
    ];
  }

  override async latestTrends(): Promise<TrendRecord[]> {
    return [{ product: "910771", trend: 1.24, low: 1.2, trendFoil: null }];
  }

  /** Game 13 fails like a driver that rejects with a plain string instead of an Error. */
  override async latestDay(game: string): Promise<string | null> {
    if (game === "13") {
      return Promise.reject("InfluxDB said no");
    }

    return "2026-10-03";
  }

  override async latestPrices(game: string, product: string): Promise<Prices | null> {
    this.calls.push(`prices ${game} ${product}`);

    return null;
  }

  override async dailyPrices(): Promise<Prices[]> {
    throw new Error("InfluxDB is down");
  }
}

/** The global Request and Response before the server starts, which it must not replace. */
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const catalog = new FakeCatalog();
const logger = LoggerFactory.silent();
let server: WebServer;
let base = "";

before(async () => {
  const images = new CardImages(await mkdtemp(join(tmpdir(), "images-")), new PoliteHttp(), new Map());

  server = new WebServer({ catalog, indexes: new CatalogIndexes(catalog, logger), images, logger });
  base = `http://127.0.0.1:${await server.listen(0, "127.0.0.1")}`;
});
after(() => server.close());

const get = async (path: string) => {
  const response = await fetch(base + path);

  return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
};

test("serves the page and Chart.js", async () => {
  for (const path of ["/", "/app.js", "/style.css", "/vendor/chart.js"]) {
    const response = await fetch(base + path);

    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
});

test("serves nothing else from disk", async () => {
  for (const path of ["/package.json", "/../package.json", "/web/index.html"]) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test("searches, filters and describes cards", async () => {
  const search = (await get("/api/search?game=1&q=sol%20rin&kind=single")).body as SearchResult;

  assert.equal(search.total, 1);
  assert.deepEqual(
    { ...search.cards[0] },
    {
      product: "910771",
      name: "Sol Ring",
      single: true,
      expansionId: 6572,
      expansion: "Commander: Foundations",
      version: null,
      added: "2026-09-21",
      trend: 1.24,
      low: 1.2,
      trendFoil: null,
    },
  );
  assert.equal(((await get("/api/search?game=1&kind=sealed")).body as SearchResult).cards[0].product, "1");
  assert.deepEqual((await get("/api/card?game=1&product=42")).body, { card: null });
  assert.deepEqual((await get("/api/expansions?game=1")).body, {
    expansions: [{ id: 6572, label: "Commander: Foundations", added: "2026-09-21", count: 2 }],
  });
  assert.deepEqual((await get("/api/prices?game=21&product=903189")).body, { prices: null });
  assert.deepEqual(catalog.calls, ["prices 21 903189"]);
});

test("refuses bad parameters before querying", async () => {
  for (const query of [
    "search?game=x",
    "search?game=1&kind=foil",
    "search?game=1&min=-1",
    "search?game=1&limit=1000",
    "prices?game=1&product=1'--",
    "daily?game=1&product=1&days=0",
    "image?game=1&product=1&size=huge",
  ]) {
    assert.equal((await get(`/api/${query}`)).status, 400, query);
  }

  assert.equal(catalog.calls.length, 1);
});

test("answers 404 for a game without images", async () => {
  assert.equal((await get("/api/image?game=21&product=903189")).status, 404);
});

test("hides database errors behind a 500", async () => {
  assert.deepEqual(await get("/api/daily?game=1&product=910771&days=30"), {
    status: 500,
    body: { error: "The server could not answer" },
  });
});

test("tells the day of the latest price guide", async () => {
  assert.deepEqual(await get("/api/latest?game=1"), { status: 200, body: { day: "2026-10-03" } });
  assert.equal((await get("/api/latest?game=x")).status, 400);
});

test("answers 404 for an unknown API and 405 for other methods", async () => {
  assert.deepEqual(await get("/api/unknown?game=1"), { status: 404, body: { error: "Not found" } });
  const response = await fetch(`${base}/api/latest?game=1`, { method: "POST" });

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Only GET is supported" });
});

test("never caches the API answers, nor any error", async () => {
  const requests = [
    { method: "GET", path: "/api/latest?game=1" },
    { method: "GET", path: "/api/latest?game=x" },
    { method: "POST", path: "/api/latest?game=1" },
    { method: "GET", path: "/favicon.ico" },
    { method: "GET", path: "/api/latest?game=13" },
  ];

  for (const { method, path } of requests) {
    const response = await fetch(base + path, { method });

    assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${path}`);
    await response.arrayBuffer();
  }
});

test("lets browsers revalidate the page files", async () => {
  const response = await fetch(`${base}/app.js`);

  assert.equal(response.headers.get("cache-control"), "no-cache");
  await response.arrayBuffer();
});

test("answers JSON when a dependency rejects with something that is not an Error", async () => {
  const response = await fetch(`${base}/api/latest?game=13`);
  const contentType = response.headers.get("content-type") ?? "";

  assert.equal(response.status, 500);
  assert.match(contentType, /^application\/json/);
  assert.deepEqual(await response.json(), { error: "The server could not answer" });
});

test("leaves the global Request and Response alone", () => {
  assert.equal(globalThis.Request, nativeRequest);
  assert.equal(globalThis.Response, nativeResponse);
});
