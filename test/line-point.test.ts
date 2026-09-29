import assert from "node:assert/strict";
import { test } from "node:test";
import { LinePoint } from "../src/influx/line-point.ts";

const day = new Date("2026-09-29T00:00:00Z");

test("writes sorted tags, float fields and a timestamp in seconds", () => {
  const line = new LinePoint("price", day).tag("product", 1).tag("game", 21).field("low", 2).field("trend", 0.15).toLine();
  assert.equal(line, "price,game=21,product=1 low=2.0,trend=0.15 1790640000");
});

test("escapes spaces, commas and equal signs in tag values", () => {
  const line = new LinePoint("price", day).tag("name", "Iden Versio, Inferno=Squad").field("low", 1).toLine();
  assert.equal(line, "price,name=Iden\\ Versio\\,\\ Inferno\\=Squad low=1.0 1790640000");
});

test("skips empty tags and missing values; a point without fields is empty", () => {
  const point = new LinePoint("price", day).tag("name", "").field("low", null).field("avg", undefined);
  assert.equal(point.isEmpty, true);
});
