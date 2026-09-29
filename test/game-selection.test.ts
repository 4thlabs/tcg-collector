import assert from "node:assert/strict";
import { test } from "node:test";
import { GameSelection } from "../src/collect/game-selection.ts";

test('"all" covers ids 1 to 40', () => {
  const ids = GameSelection.parse("all").ids;
  assert.equal(ids.length, GameSelection.defaultMaxGameId);
  assert.equal(ids[0], 1);
});

test("a list is sorted and deduplicated", () => {
  assert.deepEqual(GameSelection.parse("21, 1,21").ids, [1, 21]);
});

test("an invalid id is rejected", () => {
  assert.throws(() => GameSelection.parse("1,swu"));
});
