// Keeps one search index per game in memory, built on first use and rebuilt in the background once it is old.
import type { Logger } from "../logging/logger-factory.ts";
import type { CardCatalog } from "./card-catalog.ts";
import { CatalogIndex } from "./catalog-index.ts";

interface Entry {
  index: Promise<CatalogIndex>;
  /** When the index was built, or when its rebuild started. */
  since: number;
}

export class CatalogIndexes {
  /** The import runs once a day: an hour-old index is recent enough. */
  static readonly maxAgeMs = 60 * 60 * 1000;

  private readonly catalog: CardCatalog;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(catalog: CardCatalog, logger: Logger, now: () => number = Date.now) {
    this.catalog = catalog;
    this.logger = logger;
    this.now = now;
  }

  /** Index of a game. An old index keeps answering while the new one builds; a failed first build is retried on the next call. */
  get(game: string): Promise<CatalogIndex> {
    const entry = this.entries.get(game);
    if (!entry) {
      const index = this.build(game);
      this.entries.set(game, { index, since: this.now() });
      index.catch(() => this.entries.delete(game));
      return index;
    }
    if (this.now() - entry.since > CatalogIndexes.maxAgeMs) {
      entry.since = this.now();
      this.build(game).then(
        (index) => this.entries.set(game, { index: Promise.resolve(index), since: this.now() }),
        () => undefined, // already logged; the old index stays until the next attempt
      );
    }
    return entry.index;
  }

  private async build(game: string): Promise<CatalogIndex> {
    const started = this.now();
    try {
      const [products, trends] = await Promise.all([this.catalog.products(game), this.catalog.latestTrends(game)]);
      const index = new CatalogIndex(products, trends);
      this.logger.info(`search index of game ${game}: ${index.size} products in ${this.now() - started} ms`);
      return index;
    } catch (error) {
      this.logger.warn(`search index of game ${game} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
