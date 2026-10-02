// Reads the products and prices the web page needs from the InfluxDB tables written by the import.
import type { InfluxReader, Row } from "../influx/influx-reader.ts";

/** Latest description of a product in Cardmarket's catalogue. */
export interface ProductRecord {
  product: string;
  name: string;
  /** e.g. "Magic Single", "Magic Display". */
  category: string;
  expansionId: number | null;
  /** Date Cardmarket added the product, YYYY-MM-DD. */
  added: string | null;
}

/** Prices of the latest archived price guide, used to show and filter the list. */
export interface TrendRecord {
  product: string;
  trend: number | null;
  low: number | null;
  trendFoil: number | null;
}

/** Price fields shown by the card sheet, in euros. Cardmarket's 0 (no offer) comes back as null. */
export const priceFields = ["low", "trend", "avg1", "avg30", "low_foil", "trend_foil", "avg1_foil", "avg30_foil"] as const;
export type PriceField = (typeof priceFields)[number];
export type Prices = { day: string } & Record<PriceField, number | null>;

export class CardCatalog {
  private readonly reader: InfluxReader;

  constructor(reader: InfluxReader) {
    this.reader = reader;
  }

  /** Every product of a game, with its latest description (the product table keeps one row per catalogue change). */
  async products(game: string): Promise<ProductRecord[]> {
    const rows = await this.reader.query(
      `SELECT product, last_value(name ORDER BY time) AS name, last_value(category ORDER BY time) AS category,
              last_value(id_expansion ORDER BY time) AS expansion_id, max(date_added) AS added
       FROM product WHERE game = $game GROUP BY product`,
      { game },
    );
    return rows.map((row) => ({
      product: String(row.product),
      name: String(row.name),
      category: String(row.category ?? ""),
      expansionId: CardCatalog.numberOrNull(row.expansion_id),
      added: row.added == null ? null : String(row.added).slice(0, 10),
    }));
  }

  /** Prices of every product in the latest archived price guide of a game. */
  async latestTrends(game: string): Promise<TrendRecord[]> {
    const rows = await this.reader.query(
      `SELECT product, nullif(trend, 0) AS trend, nullif(low, 0) AS low, nullif(trend_foil, 0) AS trend_foil
       FROM price WHERE game = $game AND time = (SELECT max(time) FROM price WHERE game = $game)`,
      { game },
    );
    return rows.map((row) => ({
      product: String(row.product),
      trend: CardCatalog.numberOrNull(row.trend),
      low: CardCatalog.numberOrNull(row.low),
      trendFoil: CardCatalog.numberOrNull(row.trend_foil),
    }));
  }

  /** Latest archived prices of a product, or null when it has none. */
  async latestPrices(game: string, product: string): Promise<Prices | null> {
    const columns = priceFields.map((field) => `nullif(${field}, 0) AS ${field}`).join(", ");
    const rows = await this.reader.query(
      `SELECT time, ${columns} FROM price WHERE game = $game AND product = $product ORDER BY time DESC LIMIT 1`,
      { game, product },
    );
    return rows.length === 0 ? null : CardCatalog.toPrices(rows[0], rows[0].time);
  }

  /**
   * One row per day over the last days, starting at the first day with a price.
   * A price guide is only archived when it changes, so a day without one repeats the previous value (locf).
   */
  async dailyPrices(game: string, product: string, days: number): Promise<Prices[]> {
    const columns = priceFields.map((field) => `locf(last_value(nullif(${field}, 0) ORDER BY time)) AS ${field}`).join(", ");
    const rows = await this.reader.query(
      `SELECT date_bin_gapfill(INTERVAL '1 day', time) AS day, ${columns}
       FROM price WHERE game = $game AND product = $product
         AND time >= now() - INTERVAL '${Math.trunc(days)} days' AND time < now()
       GROUP BY 1 ORDER BY 1`,
      { game, product },
    );
    const prices = rows.map((row) => CardCatalog.toPrices(row, row.day));
    const first = prices.findIndex((day) => priceFields.some((field) => day[field] !== null));
    return first < 0 ? [] : prices.slice(first);
  }

  private static toPrices(row: Row, time: unknown): Prices {
    const prices = { day: new Date(Number(time)).toISOString().slice(0, 10) } as Prices;
    for (const field of priceFields) prices[field] = CardCatalog.numberOrNull(row[field]);
    return prices;
  }

  private static numberOrNull(value: unknown): number | null {
    return value == null ? null : Number(value);
  }
}
