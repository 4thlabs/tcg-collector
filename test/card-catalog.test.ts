import assert from "node:assert/strict";
import { test } from "node:test";
import { CardCatalog, type CardSummary } from "../src/web/card-catalog.ts";

const card = (product: string, name: string, expansionId: number | null): CardSummary => ({
  product, name, expansionId, expansion: null, version: null, added: null,
});

test("numbers the versions of one name in one expansion by idProduct", () => {
  const cards = [card("906536", "Sol Ring", 6757), card("906534", "Sol Ring", 6757), card("906535", "Sol Ring", 6757), card("910771", "Sol Ring", 6572)];
  CardCatalog.numberVersions(cards);
  assert.deepEqual(cards.map((c) => [c.product, c.version]), [["906536", 3], ["906534", 1], ["906535", 2], ["910771", null]]);
});

test("does not mix names or expansions", () => {
  const cards = [card("1", "Sol Ring", 1), card("2", "Sol Talisman", 1), card("3", "Sol Ring", 2)];
  CardCatalog.numberVersions(cards);
  assert.deepEqual(cards.map((c) => c.version), [null, null, null]);
});
