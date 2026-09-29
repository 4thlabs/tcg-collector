import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentFingerprint } from "../src/storage/content-fingerprint.ts";

const file = (createdAt: string, low: number) =>
  Buffer.from(JSON.stringify({ version: 1, createdAt, priceGuides: [{ idProduct: 1, low }] }));

test("ignore createdAt : un fichier régénéré sans changement garde la même empreinte", () => {
  assert.equal(ContentFingerprint.of(file("2026-09-28", 1.5)), ContentFingerprint.of(file("2026-09-29", 1.5)));
});

test("un prix modifié change l'empreinte", () => {
  assert.notEqual(ContentFingerprint.of(file("2026-09-28", 1.5)), ContentFingerprint.of(file("2026-09-28", 1.6)));
});
