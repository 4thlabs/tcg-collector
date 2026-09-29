// Turns one line of the price guide into an InfluxDB point.
import type { PriceGuideEntry } from "../cardmarket/feed-content.ts";
import { LinePoint } from "../influx/line-point.ts";
import type { ProductCatalog } from "./product-catalog.ts";

/**
 * Measurement "price", one point per product and per day (timestamp: the archive day at 00:00 UTC).
 * Tags: game, product, category, expansion, name (the last three from the catalogue, when the product is in it).
 * Fields: the price guide values in euros, foil ones suffixed with "_foil"; a value Cardmarket leaves empty is omitted.
 */
export class PricePointFactory {
  static readonly measurement = "price";

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
  static create(entry: PriceGuideEntry, idGame: number, day: string, catalog: ProductCatalog): LinePoint | null {
    const point = new LinePoint(PricePointFactory.measurement, new Date(`${day}T00:00:00Z`)).tag("game", idGame).tag("product", entry.idProduct);

    const product = catalog.product(entry.idProduct);
    if (product) point.tag("category", product.categoryName).tag("expansion", product.idExpansion).tag("name", product.name);

    for (const [key, field] of PricePointFactory.fields) point.field(field, entry[key] as number | null | undefined);
    return point.isEmpty ? null : point;
  }
}
