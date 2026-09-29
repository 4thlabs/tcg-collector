// Turns the Cardmarket files into database rows.
import type { PriceGuideEntry, ProductEntry } from "../cardmarket/feed-content.ts";
import type { Price, Product } from "../database/entities.ts";

export class PriceRowFactory {
  /** Null when the line has no price at all (nothing worth storing). */
  static price(entry: PriceGuideEntry, idGame: number, day: string): Price | null {
    const row: Price = {
      day,
      idProduct: entry.idProduct,
      game: idGame,
      low: entry.low ?? null,
      trend: entry.trend ?? null,
      avg: entry.avg ?? null,
      avg1: entry.avg1 ?? null,
      avg7: entry.avg7 ?? null,
      avg30: entry.avg30 ?? null,
      lowFoil: entry["low-foil"] ?? null,
      trendFoil: entry["trend-foil"] ?? null,
      avgFoil: entry["avg-foil"] ?? null,
      avg1Foil: entry["avg1-foil"] ?? null,
      avg7Foil: entry["avg7-foil"] ?? null,
      avg30Foil: entry["avg30-foil"] ?? null,
    };
    const hasPrice = Object.entries(row).some(([key, value]) => !["day", "idProduct", "game"].includes(key) && value !== null);
    return hasPrice ? row : null;
  }

  static product(entry: ProductEntry, idGame: number): Product {
    return {
      idProduct: entry.idProduct,
      game: idGame,
      name: entry.name,
      category: entry.categoryName,
      idExpansion: entry.idExpansion,
      idMetacard: entry.idMetacard,
    };
  }
}
