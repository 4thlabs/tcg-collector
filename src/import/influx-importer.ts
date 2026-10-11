// Import: writes the archived catalogues and price guides into InfluxDB, day by day,
// skipping the days already imported.
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

/** The points of one archive day. */
type DayPoints = [day: string, points: Point[]];

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
        const imported = await this.importFile(file, replay);
        summary.files += imported.files;
        summary.points += imported.points;
      }
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    this.logger.info(`Import finished in ${seconds} s: ${summary.files} files, ${summary.points} points`);
    return summary;
  }

  /** Imports the archives of one file written after its last imported day, or all of them when replaying. */
  private async importFile(file: FeedFile, replay: boolean): Promise<ImportSummary> {
    const imported: ImportSummary = { files: 0, points: 0 };
    const lastDay = replay ? undefined : this.ledger.lastDay(file.key);
    const archivedDays = await this.archive.days(file);
    const days = archivedDays.filter((day) => lastDay === undefined || day > lastDay);
    if (days.length === 0) return imported;

    for await (const [day, points] of this.pointsByDay(file, days, lastDay)) {
      // The log entry goes last, with the day's points: an interrupted import resumes where it stopped.
      const logEntry = this.ledger.entry(file.key, file.idGame, day, points.length);
      await this.writer.write([...points, logEntry]);
      this.ledger.record(file.key, day);
      imported.files++;
      imported.points += points.length;
      this.logger.info(`imported ${file.key} ${day} (${points.length} points)`);
    }
    return imported;
  }

  private pointsByDay(file: FeedFile, days: readonly string[], lastDay: string | undefined): AsyncGenerator<DayPoints> {
    if (file.kind === FeedKind.priceGuide) return this.pricePoints(file, days);
    return this.productPoints(file, days, lastDay);
  }

  /** One point per product with at least one price. */
  private async *pricePoints(file: FeedFile, days: readonly string[]): AsyncGenerator<DayPoints> {
    for (const day of days) {
      const content = await this.archive.read<PriceGuideContent>(file, day);
      const points: Point[] = [];
      for (const entry of content.priceGuides) {
        const point = PricePointFactory.create(entry, file.idGame, day);
        if (!point) continue;
        points.push(point);
      }
      yield [day, points];
    }
  }

  /**
   * Only the products that are new or changed since the previous archive of the same catalogue
   * (the one of lastDay, already imported; none on a first import or a replay).
   */
  private async *productPoints(
    file: FeedFile,
    days: readonly string[],
    lastDay: string | undefined,
  ): AsyncGenerator<DayPoints> {
    let previous = new Map<number, ProductEntry>();
    if (lastDay !== undefined) {
      previous = await this.productsOn(file, lastDay);
    }

    for (const day of days) {
      const current = await this.productsOn(file, day);
      const points: Point[] = [];
      for (const entry of current.values()) {
        const before = previous.get(entry.idProduct);
        if (!ProductPointFactory.changed(entry, before)) continue;
        points.push(ProductPointFactory.create(entry, file.idGame, day));
      }
      previous = current;
      yield [day, points];
    }
  }

  /** The products of one catalogue archive, by idProduct. */
  private async productsOn(file: FeedFile, day: string): Promise<Map<number, ProductEntry>> {
    const content = await this.archive.read<ProductListContent>(file, day);
    const products = new Map<number, ProductEntry>();
    for (const product of content.products) {
      products.set(product.idProduct, product);
    }
    return products;
  }
}
