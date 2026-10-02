import assert from "node:assert/strict";
import { test } from "node:test";
import { ExpansionLabel } from "../src/web/expansion-label.ts";

test("prefers the full set name", () => {
  assert.equal(ExpansionLabel.fromSealedNames(["Bloomburrow Booster Box", "Bloomburrow: Full Set"]), "Bloomburrow");
  assert.equal(ExpansionLabel.fromSealedNames(["Signature Spellbook: Jace: Full Set (Sealed)"]), "Signature Spellbook: Jace");
});

test("uses a rarity set name", () => {
  assert.equal(ExpansionLabel.fromSealedNames(["Spark of Rebellion Booster", "Spark of Rebellion Rare Set"]), "Spark of Rebellion");
});

test("takes the shortest deck prefix", () => {
  const names = ['Commander: Foundations: ""Jump Scare!""', 'Commander: Foundations: ""Elves""'];
  assert.equal(ExpansionLabel.fromSealedNames(names), "Commander: Foundations");
});

test("keeps the words all the names share", () => {
  assert.equal(ExpansionLabel.fromSealedNames(["Ashes of the Empire Booster Box", "Ashes of the Empire Carbonite Pack"]), "Ashes of the Empire");
});

test("falls back to the shortest name without its packaging", () => {
  assert.equal(ExpansionLabel.fromSealedNames(["Mystery Booster 2 Display"]), "Mystery");
  assert.equal(ExpansionLabel.fromSealedNames(["Kaldheim Booster Box", "Kaldheim: Theme Booster: Elves"]), "Kaldheim");
});

test("has no label without sealed products", () => {
  assert.equal(ExpansionLabel.fromSealedNames([]), null);
});
