// Cards and prices as the web page needs them, read from the InfluxDB tables written by the import.
import type { InfluxReader, Row } from "../influx/influx-reader.ts";
import { ExpansionLabel } from "./expansion-label.ts";

/** One product found by name. */
export interface CardSummary {
  product: string;
  name: string;
  expansionId: number | null;
  /** Expansion name guessed from its sealed products; null when it has none. */
  expansion: string | null;
  /** 1, 2… when the expansion has several products with this name (Cardmarket's V.1, V.2…), else null. */
  version: number | null;
  /** Date Cardmarket added the product, YYYY-MM-DD. */
  added: string | null;
}

/** Price fields shown by the page, in euros. Cardmarket's 0 (no offer) comes back as null. */
export const priceFields = ["low", "trend", "avg30", "low_foil", "trend_foil", "avg30_foil"] as const;
export type PriceField = (typeof priceFields)[number];
export type Prices = { day: string } & Record<PriceField, number | null>;

export class CardCatalog {
  static readonly searchLimit = 80;

  private readonly reader: InfluxReader;
  /** "game/expansion id" -> label. Only found labels are kept: an expansion can get its sealed products later. */
  private readonly expansionLabels = new Map<string, string>();

  constructor(reader: InfluxReader) {
    this.reader = reader;
  }

  /** Products of a game whose name contains the text, most recently added first. */
  async search(game: string, text: string): Promise<CardSummary[]> {
    // The product table keeps one row per catalogue change: take each product's latest description.
    const rows = await this.reader.query(
      `SELECT product, last_value(name ORDER BY time) AS name, last_value(id_expansion ORDER BY time) AS expansion_id,
              max(date_added) AS added
       FROM product WHERE game = $game AND name ILIKE $pattern
       GROUP BY product ORDER BY added DESC, product LIMIT ${CardCatalog.searchLimit}`,
      { game, pattern: `%${text}%` },
    );
    const cards = rows.map((row) => ({
      product: String(row.product),
      name: String(row.name),
      expansionId: CardCatalog.numberOrNull(row.expansion_id),
      expansion: null,
      version: null,
      added: row.added == null ? null : String(row.added).slice(0, 10),
    }));
    CardCatalog.numberVersions(cards);
    const labels = await this.labelsOf(game, cards.map((card) => card.expansionId));
    return cards.map((card) => ({ ...card, expansion: card.expansionId === null ? null : (labels.get(card.expansionId) ?? null) }));
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

  /** Same name in the same expansion: numbers the versions by idProduct, the order Cardmarket uses for V.1, V.2… */
  static numberVersions(cards: CardSummary[]): void {
    const groups = Map.groupBy(cards, (card) => `${card.expansionId}/${card.name}`);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => Number(a.product) - Number(b.product));
      group.forEach((card, index) => (card.version = index + 1));
    }
  }

  /** Labels of these expansions, from the names of their sealed products (cached). */
  private async labelsOf(game: string, ids: readonly (number | null)[]): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id) => id !== null))];
    const missing = wanted.filter((id) => !this.expansionLabels.has(`${game}/${id}`));
    if (missing.length > 0) {
      // The ids are numbers read from InfluxDB, safe to write into the SQL.
      const rows = await this.reader.query(
        `SELECT DISTINCT id_expansion, name FROM product
         WHERE game = $game AND id_expansion IN (${missing.join(", ")}) AND category NOT LIKE '%Single'`,
        { game },
      );
      const names = Map.groupBy(rows, (row) => Number(row.id_expansion));
      for (const id of missing) {
        const label = ExpansionLabel.fromSealedNames((names.get(id) ?? []).map((row) => String(row.name)));
        if (label) this.expansionLabels.set(`${game}/${id}`, label);
      }
    }
    const labels = new Map<number, string>();
    for (const id of wanted) {
      const label = this.expansionLabels.get(`${game}/${id}`);
      if (label) labels.set(id, label);
    }
    return labels;
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
