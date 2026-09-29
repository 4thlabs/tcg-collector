// Import: writes the archived catalogues and price guides into InfluxDB, day by day, skipping the days already imported.
import type { Point } from "@influxdata/influxdb3-client";
import type { PriceGuideContent, ProductEntry, ProductListContent } from "../cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import type { GameSelection } from "../collect/game-selection.ts";
import type { InfluxWriter } from "../influx/influx-writer.ts";
import type { Logger } from "../logging/logger-factory.ts";
import type { SnapshotArchive } from "../storage/snapshot-archive.ts";
import type { ImportLedger } from "./import-ledger.ts";
import { PricePointFactory } from "./price-point-factory.ts";
import { ProductPointFactory } from "./product-point-factory.ts";

export interface ImportSummary {
  files: number;
  points: number;
}

/** Catalogues first, so the products of a day are there before its prices. */
const importedKinds = [FeedKind.singles, FeedKind.nonSingles, FeedKind.priceGuide] as const;

export class InfluxImporter {
  private readonly archive: SnapshotArchive;
  private readonly ledger: ImportLedger;
  private readonly writer: InfluxWriter;
  private readonly logger: Logger;

  constructor(archive: SnapshotArchive, ledger: ImportLedger, writer: InfluxWriter, logger: Logger) {
    this.archive = archive;
    this.ledger = ledger;
    this.writer = writer;
    this.logger = logger;
  }

  /**
   * Imports the archives after the last imported day of each file, oldest first.
   * replay: imports every archive again. Harmless: InfluxDB keeps one row per table, tag set and time.
   */
  async import(games: GameSelection, replay = false): Promise<ImportSummary> {
    const started = Date.now();
    const summary: ImportSummary = { files: 0, points: 0 };

    for (const idGame of games.ids) {
      for (const kind of importedKinds) {
        const file = new FeedFile(kind, idGame);
        const lastDay = replay ? undefined : this.ledger.lastDay(file.key);
        const days = (await this.archive.days(file)).filter((day) => lastDay === undefined || day > lastDay);
        if (days.length === 0) continue;

        const points = kind === FeedKind.priceGuide ? this.pricePoints(file, days) : this.productPoints(file, days, lastDay);
        for await (const [day, dayPoints] of points) {
          summary.points += await this.writer.write(dayPoints);
          summary.files++;
          // Recorded after each day: an interrupted import resumes where it stopped.
          this.ledger.record(file.key, day);
          await this.ledger.save();
          this.logger.info(`imported ${file.key} ${day} (${dayPoints.length} points)`);
        }
      }
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    this.logger.info(`Import finished in ${seconds} s: ${summary.files} files, ${summary.points} points`);
    return summary;
  }

  /** One point per product with at least one price. */
  private async *pricePoints(file: FeedFile, days: readonly string[]): AsyncGenerator<[string, Point[]]> {
    for (const day of days) {
      const content = await this.archive.read<PriceGuideContent>(file, day);
      const points: Point[] = [];
      for (const entry of content.priceGuides) {
        const point = PricePointFactory.create(entry, file.idGame, day);
        if (point) points.push(point);
      }
      yield [day, points];
    }
  }

  /**
   * Only the products that are new or changed since the previous archive of the same catalogue
   * (the one of lastDay, already imported; none on a first import or a replay).
   */
  private async *productPoints(file: FeedFile, days: readonly string[], lastDay: string | undefined): AsyncGenerator<[string, Point[]]> {
    let previous = new Map<number, ProductEntry>();
    if (lastDay !== undefined) previous = InfluxImporter.byId((await this.archive.read<ProductListContent>(file, lastDay)).products);

    for (const day of days) {
      const current = InfluxImporter.byId((await this.archive.read<ProductListContent>(file, day)).products);
      const points: Point[] = [];
      for (const entry of current.values()) {
        if (ProductPointFactory.changed(entry, previous.get(entry.idProduct))) points.push(ProductPointFactory.create(entry, file.idGame, day));
      }
      previous = current;
      yield [day, points];
    }
  }

  private static byId(products: readonly ProductEntry[]): Map<number, ProductEntry> {
    return new Map(products.map((product) => [product.idProduct, product]));
  }
}
