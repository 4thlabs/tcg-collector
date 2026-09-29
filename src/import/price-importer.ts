// Import: writes the archived price guides into the price database, day by day, skipping the days already imported.
import type { PriceGuideContent } from "../cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import type { GameSelection } from "../collect/game-selection.ts";
import type { Price, Product } from "../database/entities.ts";
import type { Logger } from "../logging/logger-factory.ts";
import type { SnapshotArchive } from "../storage/snapshot-archive.ts";
import { PriceRowFactory } from "./price-row-factory.ts";
import { CatalogLoader, type ProductCatalog } from "./product-catalog.ts";

/** What the importer needs from the database (PriceDatabase, or a fake in tests). */
export interface PriceStore {
  importedDays(feed: string): Promise<Set<string>>;
  saveDay(feed: string, day: string, prices: readonly Price[], products?: readonly Product[]): Promise<void>;
}

export interface ImportSummary {
  files: number;
  rows: number;
}

export class PriceImporter {
  private readonly archive: SnapshotArchive;
  private readonly store: PriceStore;
  private readonly logger: Logger;

  constructor(archive: SnapshotArchive, store: PriceStore, logger: Logger) {
    this.archive = archive;
    this.store = store;
    this.logger = logger;
  }

  /**
   * Imports the archived price guides not imported yet, oldest first. The database records each imported day,
   * so a new or emptied database is filled from the whole archive.
   * replay: imports every archive again; existing rows are updated, never duplicated.
   */
  async import(games: GameSelection, replay = false): Promise<ImportSummary> {
    const started = Date.now();
    const summary: ImportSummary = { files: 0, rows: 0 };
    const catalogs = new CatalogLoader(this.archive);

    for (const idGame of games.ids) {
      const file = new FeedFile(FeedKind.priceGuide, idGame);
      const imported = replay ? new Set<string>() : await this.store.importedDays(file.key);
      const days = (await this.archive.days(file)).filter((day) => !imported.has(day));
      // Products are written with the first day, then only when the catalogue changes.
      let savedCatalog: string | undefined;

      for (const day of days) {
        const catalog = await catalogs.load(idGame, day);
        const products = catalog.version !== savedCatalog ? this.productsOf(catalog, idGame) : undefined;
        const prices = await this.pricesOf(file, day);
        await this.store.saveDay(file.key, day, prices, products);
        savedCatalog = catalog.version;
        summary.files++;
        summary.rows += prices.length;
        this.logger.info(`imported ${file.key} ${day} (${prices.length} prices${products ? `, ${products.length} products` : ""})`);
      }
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    this.logger.info(`Import finished in ${seconds} s: ${summary.files} price guides, ${summary.rows} prices`);
    return summary;
  }

  private productsOf(catalog: ProductCatalog, idGame: number): Product[] {
    if (catalog.size === 0) this.logger.warn(`no catalogue archived for game ${idGame}: prices are imported without product names`);
    return [...catalog.all].map((entry) => PriceRowFactory.product(entry, idGame));
  }

  private async pricesOf(file: FeedFile, day: string): Promise<Price[]> {
    const content = await this.archive.read<PriceGuideContent>(file, day);
    const prices: Price[] = [];
    for (const entry of content.priceGuides) {
      const row = PriceRowFactory.price(entry, file.idGame, day);
      if (row) prices.push(row);
    }
    return prices;
  }
}
