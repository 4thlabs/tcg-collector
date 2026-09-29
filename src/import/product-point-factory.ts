// Turns one product of a catalogue into an InfluxDB point.
import { Point } from "@influxdata/influxdb3-client";
import type { ProductEntry } from "../cardmarket/feed-content.ts";

/**
 * Table "product": one point per product each time it appears or changes in a catalogue
 * (timestamp: the catalogue archive day at 00:00 UTC). The latest point of a product is its current description.
 * Tags: game, product. Fields: name, category (e.g. "Magic Single"), date_added, id_category, id_expansion, id_metacard.
 */
export class ProductPointFactory {
  static readonly table = "product";

  static create(entry: ProductEntry, idGame: number, day: string): Point {
    return Point.measurement(ProductPointFactory.table)
      .setTag("game", String(idGame))
      .setTag("product", String(entry.idProduct))
      .setStringField("name", entry.name)
      .setStringField("category", entry.categoryName)
      .setStringField("date_added", entry.dateAdded)
      .setIntegerField("id_category", entry.idCategory)
      .setIntegerField("id_expansion", entry.idExpansion)
      .setIntegerField("id_metacard", entry.idMetacard)
      .setTimestamp(new Date(`${day}T00:00:00Z`));
  }

  /** True when the product is new or one of its fields changed since the previous catalogue. */
  static changed(entry: ProductEntry, previous: ProductEntry | undefined): boolean {
    return (
      !previous ||
      previous.name !== entry.name ||
      previous.categoryName !== entry.categoryName ||
      previous.dateAdded !== entry.dateAdded ||
      previous.idCategory !== entry.idCategory ||
      previous.idExpansion !== entry.idExpansion ||
      previous.idMetacard !== entry.idMetacard
    );
  }
}
