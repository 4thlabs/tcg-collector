// Turns one line of the price guide into an InfluxDB point.
import { Point } from "@influxdata/influxdb3-client";
import type { PriceGuideEntry } from "../cardmarket/feed-content.ts";

/**
 * Table "price", one point per product and per day (timestamp: the archive day at 00:00 UTC).
 * Tags: game, product. Names and expansions are in the "product" table (see ProductPointFactory).
 * Fields: the price guide values in euros, foil ones suffixed with "_foil"; a value Cardmarket leaves empty is omitted.
 */
export class PricePointFactory {
  static readonly table = "price";

  /** Price guide key -> field name. */
  private static readonly fields: readonly (readonly [keyof PriceGuideEntry, string])[] = [
    ["low", "low"],
    ["trend", "trend"],
    ["avg", "avg"],
    ["avg1", "avg1"],
    ["avg7", "avg7"],
    ["avg30", "avg30"],
    ["low-foil", "low_foil"],
    ["trend-foil", "trend_foil"],
    ["avg-foil", "avg_foil"],
    ["avg1-foil", "avg1_foil"],
    ["avg7-foil", "avg7_foil"],
    ["avg30-foil", "avg30_foil"],
  ];

  /** Null when the line has no price at all (nothing to write). */
  static create(entry: PriceGuideEntry, idGame: number, day: string): Point | null {
    const point = Point.measurement(PricePointFactory.table)
      .setTag("game", String(idGame))
      .setTag("product", String(entry.idProduct))
      .setTimestamp(new Date(`${day}T00:00:00Z`));

    let empty = true;
    for (const [key, field] of PricePointFactory.fields) {
      const value = entry[key] as number | null | undefined;
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      point.setFloatField(field, value);
      empty = false;
    }
    return empty ? null : point;
  }
}
