// Keeps one search index per game in memory, built on first use and rebuilt in the background once it is old.
import { ErrorMessage } from "../logging/error-message.ts";
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

  /** Index of a game: built on the first call, then rebuilt in the background once it is old. */
  get(game: string): Promise<CatalogIndex> {
    const entry = this.entries.get(game);

    if (!entry) {
      return this.buildFirst(game);
    }

    const ageMs = this.now() - entry.since;

    if (ageMs > CatalogIndexes.maxAgeMs) {
      this.rebuildInBackground(game, entry);
    }

    return entry.index;
  }

  /** A failed first build is forgotten, so the next call tries again. */
  private buildFirst(game: string): Promise<CatalogIndex> {
    const index = this.build(game);

    this.entries.set(game, { index, since: this.now() });
    index.catch(() => this.entries.delete(game));

    return index;
  }

  /** The old index keeps answering until the new one is ready, and stays until the next attempt on failure. */
  private rebuildInBackground(game: string, entry: Entry): void {
    // Moving "since" now keeps the calls made during the rebuild from starting another one.
    entry.since = this.now();
    this.build(game).then(
      (index) => this.entries.set(game, { index: Promise.resolve(index), since: this.now() }),
      () => undefined, // already logged by build()
    );
  }

  private async build(game: string): Promise<CatalogIndex> {
    const started = this.now();

    try {
      const [products, trends] = await Promise.all([this.catalog.products(game), this.catalog.latestTrends(game)]);
      const index = new CatalogIndex(products, trends);
      const durationMs = this.now() - started;

      this.logger.info(`search index of game ${game}: ${index.size} products in ${durationMs} ms`);

      return index;
    } catch (error) {
      const message = ErrorMessage.of(error);

      this.logger.warn(`search index of game ${game} failed: ${message}`);
      throw error;
    }
  }
}
