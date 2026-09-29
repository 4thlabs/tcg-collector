import assert from "node:assert/strict";
import { test } from "node:test";
import { DailyScheduler } from "../src/collect/daily-scheduler.ts";

const scheduler = new DailyScheduler("12:00", async () => {});

test("avant l'heure : exécution le jour même", () => {
  assert.equal(scheduler.nextRun(new Date("2026-09-29T06:00:00Z")).toISOString(), "2026-09-29T12:00:00.000Z");
});

test("à l'heure ou après : exécution le lendemain", () => {
  assert.equal(scheduler.nextRun(new Date("2026-09-29T12:00:00Z")).toISOString(), "2026-09-30T12:00:00.000Z");
  assert.equal(scheduler.nextRun(new Date("2026-12-31T23:00:00Z")).toISOString(), "2027-01-01T12:00:00.000Z");
});

test("une heure mal formée est refusée", () => {
  assert.throws(() => new DailyScheduler("25:00", async () => {}));
});
