import assert from "node:assert/strict";
import { test } from "node:test";
import { LoggerFactory } from "../src/logging/logger-factory.ts";

test("creates a logger at the requested level", () => {
  assert.equal(LoggerFactory.create("debug").level, "debug");
});

test("an unknown level is rejected", () => {
  assert.throws(() => LoggerFactory.create("verbose"));
});
