import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentFingerprint } from "../src/storage/content-fingerprint.ts";

const file = (createdAt: string, low: number) =>
  Buffer.from(JSON.stringify({ version: 1, createdAt, priceGuides: [{ idProduct: 1, low }] }));

test("ignores createdAt: a file regenerated without changes keeps the same fingerprint", () => {
  assert.equal(ContentFingerprint.of(file("2026-09-28", 1.5)), ContentFingerprint.of(file("2026-09-29", 1.5)));
});

test("a changed price changes the fingerprint", () => {
  assert.notEqual(ContentFingerprint.of(file("2026-09-28", 1.5)), ContentFingerprint.of(file("2026-09-28", 1.6)));
});
