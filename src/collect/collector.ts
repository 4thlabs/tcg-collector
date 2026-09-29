// Collection: for each game and file type, archives today's version when its content changed.
import type { CardmarketClient } from "../cardmarket/cardmarket-client.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import type { Logger } from "../logging/logger-factory.ts";
import { ContentFingerprint } from "../storage/content-fingerprint.ts";
import type { FingerprintLedger } from "../storage/fingerprint-ledger.ts";
import type { SnapshotArchive } from "../storage/snapshot-archive.ts";
import { CollectReport, type Outcome } from "./collect-report.ts";
import type { GameSelection } from "./game-selection.ts";

export class Collector {
  private readonly client: CardmarketClient;
  private readonly ledger: FingerprintLedger;
  private readonly archive: SnapshotArchive;
  private readonly logger: Logger;
  private readonly kinds: readonly FeedKind[];

  constructor(client: CardmarketClient, ledger: FingerprintLedger, archive: SnapshotArchive, logger: Logger, kinds = FeedKind.all) {
    this.client = client;
    this.ledger = ledger;
    this.archive = archive;
    this.logger = logger;
    this.kinds = kinds;
  }

  /** Sequential collection (one file at a time, to stay gentle with Cardmarket). */
  async collect(games: GameSelection, now = new Date()): Promise<CollectReport> {
    this.logger.info(`Collection started for ${games.ids.length} game ids`);
    const report = new CollectReport();
    for (const idGame of games.ids) {
      for (const kind of this.kinds) {
        const file = new FeedFile(kind, idGame);
        try {
          const { outcome, bytes } = await this.collectFile(file, now);
          report.add(file.key, outcome, bytes);
          // Archives are the interesting events; the rest is only visible at debug level.
          if (outcome === "archived") this.logger.info(`archived ${file.key} (${(bytes / 1e6).toFixed(2)} MB)`);
          else this.logger.debug(`${outcome} ${file.key}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.add(file.key, "failed", 0, message);
          this.logger.warn(`failed ${file.key}: ${message}`);
        }
      }
      // The ledger is saved after each game: an interrupted collection keeps what it already got.
      await this.ledger.save();
    }
    return report;
  }

  private async collectFile(file: FeedFile, now: Date): Promise<{ outcome: Outcome; bytes: number }> {
    const version = await this.client.probe(file);
    if (!version) return { outcome: "absent", bytes: 0 };

    const previous = this.ledger.entry(file.key);
    const checkedAt = now.toISOString();
    if (previous && previous.etag === version.etag) {
      this.ledger.record(file.key, { ...previous, checkedAt });
      return { outcome: "unchanged", bytes: 0 };
    }

    const body = await this.client.download(file);
    const fingerprint = ContentFingerprint.of(body);
    if (previous && previous.fingerprint === fingerprint) {
      this.ledger.record(file.key, { ...previous, etag: version.etag, checkedAt });
      return { outcome: "same-content", bytes: 0 };
    }

    const day = checkedAt.slice(0, 10);
    const stored = await this.archive.store(file, day, body);
    this.ledger.record(file.key, { etag: version.etag, fingerprint, archivedOn: day, checkedAt });
    return { outcome: "archived", bytes: stored.compressedSize };
  }
}
