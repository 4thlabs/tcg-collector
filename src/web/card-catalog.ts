// Reads the products and prices the web page needs from the InfluxDB tables written by the import.
import { InfluxDay } from "../influx/influx-day.ts";
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
export const priceFields = [
  "low",
  "trend",
  "avg1",
  "avg30",
  "low_foil",
  "trend_foil",
  "avg1_foil",
  "avg30_foil",
] as const;
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
      `SELECT product,
              last_value(name ORDER BY time) AS name,
              last_value(category ORDER BY time) AS category,
              last_value(id_expansion ORDER BY time) AS expansion_id,
              max(date_added) AS added
       FROM product
       WHERE game = $game
       GROUP BY product`,
      { game },
    );
    return rows.map((row) => CardCatalog.toProduct(row));
  }

  /** Prices of every product in the latest archived price guide of a game. */
  async latestTrends(game: string): Promise<TrendRecord[]> {
    const rows = await this.reader.query(
      `SELECT product, nullif(trend, 0) AS trend, nullif(low, 0) AS low, nullif(trend_foil, 0) AS trend_foil
       FROM price
       WHERE game = $game AND time = (SELECT max(time) FROM price WHERE game = $game)`,
      { game },
    );
    return rows.map((row) => ({
      product: String(row.product),
      trend: CardCatalog.numberOrNull(row.trend),
      low: CardCatalog.numberOrNull(row.low),
      trendFoil: CardCatalog.numberOrNull(row.trend_foil),
    }));
  }

  /** Day of the latest archived price guide of a game (YYYY-MM-DD), or null when none was imported. */
  async latestDay(game: string): Promise<string | null> {
    const rows = await this.reader.query(`SELECT max(time) AS day FROM price WHERE game = $game`, { game });
    const day = rows[0]?.day;
    if (day == null) return null;
    return InfluxDay.of(day);
  }

  /** Latest archived prices of a product, or null when it has none. */
  async latestPrices(game: string, product: string): Promise<Prices | null> {
    const columns = priceFields.map((field) => `nullif(${field}, 0) AS ${field}`).join(", ");
    const rows = await this.reader.query(
      `SELECT time, ${columns}
       FROM price
       WHERE game = $game AND product = $product
       ORDER BY time DESC
       LIMIT 1`,
      { game, product },
    );
    if (rows.length === 0) return null;
    return CardCatalog.toPrices(rows[0], rows[0].time);
  }

  /**
   * One row per day over the last days, starting at the first day with a price.
   * A price guide is only archived when it changes, so a day without one repeats the previous value (locf).
   */
  async dailyPrices(game: string, product: string, days: number): Promise<Prices[]> {
    // Each day takes the day's last price, or the previous day's when it has none.
    const columnOf = (field: PriceField) => `locf(last_value(nullif(${field}, 0) ORDER BY time)) AS ${field}`;
    const columns = priceFields.map(columnOf).join(", ");
    // An interval cannot be a query parameter: the number of days, a whole number, is written into the SQL.
    const period = `${Math.trunc(days)} days`;
    const rows = await this.reader.query(
      `SELECT date_bin_gapfill(INTERVAL '1 day', time) AS day, ${columns}
       FROM price
       WHERE game = $game AND product = $product AND time >= now() - INTERVAL '${period}' AND time < now()
       GROUP BY 1
       ORDER BY 1`,
      { game, product },
    );
    const prices = rows.map((row) => CardCatalog.toPrices(row, row.day));
    const hasPrice = (day: Prices) => priceFields.some((field) => day[field] !== null);
    const first = prices.findIndex(hasPrice);
    if (first < 0) return [];
    return prices.slice(first);
  }

  private static toProduct(row: Row): ProductRecord {
    // date_added is a date and time; the page only shows the day.
    const added = row.added == null ? null : String(row.added).slice(0, 10);
    return {
      product: String(row.product),
      name: String(row.name),
      category: String(row.category ?? ""),
      expansionId: CardCatalog.numberOrNull(row.expansion_id),
      added,
    };
  }

  private static toPrices(row: Row, time: unknown): Prices {
    const prices = { day: InfluxDay.of(time) } as Prices;
    for (const field of priceFields) {
      prices[field] = CardCatalog.numberOrNull(row[field]);
    }
    return prices;
  }

  private static numberOrNull(value: unknown): number | null {
    if (value == null) return null;
    return Number(value);
  }
}
