import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProductRecord, TrendRecord } from "../src/web/card-catalog.ts";
import { CatalogIndex, type SearchRequest } from "../src/web/catalog-index.ts";

const product = (id: string, name: string, expansionId: number, category = "Magic Single", added = "2026-01-01"): ProductRecord => ({
  product: id, name, category, expansionId, added,
});
const trend = (id: string, value: number | null): TrendRecord => ({ product: id, trend: value, low: value, trendFoil: null });

const index = new CatalogIndex(
  [
    product("906534", "Sol Ring", 6757, "Magic Single", "2026-09-03"),
    product("906536", "Sol Ring", 6757, "Magic Single", "2026-09-03"),
    product("906535", "Sol Ring", 6757, "Magic Single", "2026-09-03"),
    product("910771", "Sol Ring", 6572, "Magic Single", "2026-09-21"),
    product("15451", "Sol Ring", 1, "Magic Single", "2002-01-01"),
    product("1", "Alpha Booster", 1, "Magic Booster"),
    product("2", "Jace, the Mind Sculptor", 3, "Magic Single", "2011-01-01"),
    product("3", "Sol Talisman", 3),
    product("4", 'Commander: Foundations: ""Elves""', 6572, "Magic Theme Deck Display"),
  ],
  [trend("906534", 12), trend("906535", 30), trend("910771", 1.24), trend("15451", 900), trend("2", 15), trend("1", 4000)],
);

const find = (request: Partial<SearchRequest>) =>
  index.find({ text: "", kind: "all", sort: "relevance", offset: 0, limit: 50, ...request }).cards.map((card) => card.product);

test("numbers the versions of one name in one expansion by idProduct", () => {
  assert.deepEqual(["906534", "906535", "906536", "910771"].map((id) => index.card(id)?.version), [1, 2, 3, null]);
});

test("names expansions after their sealed products", () => {
  assert.equal(index.card("910771")?.expansion, "Commander: Foundations");
  assert.equal(index.card("15451")?.expansion, "Alpha");
  assert.equal(index.card("906534")?.expansion, null);
  assert.deepEqual(index.expansions.map((expansion) => expansion.label), ["Commander: Foundations", "Alpha"]);
});

test("finds words in any order, as prefixes, best match then newest", () => {
  assert.deepEqual(find({ text: "ring sol" }), ["910771", "906536", "906535", "906534", "15451"]);
  assert.deepEqual(find({ text: "jace mind" }), ["2"]);
});

test("tolerates a typo only when nothing matches as typed", () => {
  assert.deepEqual(find({ text: "jace mind sculptr" }), ["2"]);
  assert.deepEqual(find({ text: "sol" }).includes("3"), true);
});

test("filters by expansion, type and trend price", () => {
  assert.deepEqual(find({ expansionId: 6572 }), ["910771", "4"]);
  assert.deepEqual(find({ text: "alpha", kind: "single" }), []);
  assert.deepEqual(find({ kind: "sealed", sort: "newest" }), ["4", "1"]);
  assert.deepEqual(find({ text: "sol ring", minTrend: 10, maxTrend: 100, sort: "trend-desc" }), ["906535", "906534"]);
});

test("sorts by trend with unpriced products last, and pages", () => {
  assert.deepEqual(find({ text: "sol ring", sort: "trend-asc" }), ["910771", "906534", "906535", "15451", "906536"]);
  const page = index.find({ text: "sol ring", kind: "all", sort: "trend-desc", offset: 1, limit: 2 });
  assert.equal(page.total, 5);
  assert.deepEqual(page.cards.map((card) => card.product), ["906535", "906534"]);
});
