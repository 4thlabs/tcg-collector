import assert from "node:assert/strict";
import { test } from "node:test";
import { GameSelection } from "../src/collect/game-selection.ts";

test("« all » couvre les identifiants 1 à 40", () => {
  const ids = GameSelection.parse("all").ids;
  assert.equal(ids.length, GameSelection.defaultMaxGameId);
  assert.equal(ids[0], 1);
});

test("une liste est triée et dédoublonnée", () => {
  assert.deepEqual(GameSelection.parse("21, 1,21").ids, [1, 21]);
});

test("un identifiant invalide est refusé", () => {
  assert.throws(() => GameSelection.parse("1,swu"));
});
