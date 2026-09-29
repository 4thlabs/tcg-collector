import assert from "node:assert/strict";
import { test } from "node:test";
import { DailyScheduler } from "../src/collect/daily-scheduler.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";

const scheduler = new DailyScheduler("12:00", async () => {}, LoggerFactory.silent());

test("before the time: runs the same day", () => {
  assert.equal(scheduler.nextRun(new Date("2026-09-29T06:00:00Z")).toISOString(), "2026-09-29T12:00:00.000Z");
});

test("at or after the time: runs the next day", () => {
  assert.equal(scheduler.nextRun(new Date("2026-09-29T12:00:00Z")).toISOString(), "2026-09-30T12:00:00.000Z");
  assert.equal(scheduler.nextRun(new Date("2026-12-31T23:00:00Z")).toISOString(), "2027-01-01T12:00:00.000Z");
});

test("a malformed time is rejected", () => {
  assert.throws(() => new DailyScheduler("25:00", async () => {}, LoggerFactory.silent()));
});
