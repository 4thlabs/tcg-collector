// Import: writes the archived price guides into InfluxDB, day by day, skipping the days already imported.
import type { PriceGuideContent } from "../cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import type { GameSelection } from "../collect/game-selection.ts";
import type { InfluxWriter } from "../influx/influx-writer.ts";
import type { LinePoint } from "../influx/line-point.ts";
import type { Logger } from "../logging/logger-factory.ts";
import type { SnapshotArchive } from "../storage/snapshot-archive.ts";
import { CatalogLoader } from "./product-catalog.ts";
import type { ImportLedger } from "./import-ledger.ts";
import { PricePointFactory } from "./price-point-factory.ts";

export interface ImportSummary {
  files: number;
  points: number;
}

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
   * Imports the price guides archived after the last imported day of each game, oldest first.
   * replay: imports every archive again. Harmless: InfluxDB overwrites a point with the same series and time.
   */
  async import(games: GameSelection, replay = false): Promise<ImportSummary> {
    const started = Date.now();
    const summary: ImportSummary = { files: 0, points: 0 };
    const catalogs = new CatalogLoader(this.archive);

    for (const idGame of games.ids) {
      const file = new FeedFile(FeedKind.priceGuide, idGame);
      const lastDay = replay ? undefined : this.ledger.lastDay(file.key);
      const days = (await this.archive.days(file)).filter((day) => lastDay === undefined || day > lastDay);

      for (const day of days) {
        const points = await this.pointsOf(file, day, catalogs);
        summary.points += await this.writer.write(points);
        summary.files++;
        // Recorded after each day: an interrupted import resumes where it stopped.
        this.ledger.record(file.key, day);
        await this.ledger.save();
        this.logger.info(`imported ${file.key} ${day} (${points.length} points)`);
      }
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    this.logger.info(`Import finished in ${seconds} s: ${summary.files} price guides, ${summary.points} points`);
    return summary;
  }

  private async pointsOf(file: FeedFile, day: string, catalogs: CatalogLoader): Promise<LinePoint[]> {
    const content = await this.archive.read<PriceGuideContent>(file, day);
    const catalog = await catalogs.load(file.idGame, day);
    if (catalog.size === 0) this.logger.warn(`no catalogue archived for game ${file.idGame}: points of ${day} have no name`);

    const points: LinePoint[] = [];
    for (const entry of content.priceGuides) {
      const point = PricePointFactory.create(entry, file.idGame, day, catalog);
      if (point) points.push(point);
    }
    return points;
  }
}
