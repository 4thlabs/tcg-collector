// Wires the dependencies from the global options (data folder, Cardmarket URL, logging) and DATABASE_URL.
import { join } from "node:path";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { Collector } from "./collect/collector.ts";
import { PriceDatabase } from "./database/price-database.ts";
import { PriceImporter } from "./import/price-importer.ts";
import { LoggerFactory, type LogFormat, type Logger } from "./logging/logger-factory.ts";
import { FingerprintLedger } from "./storage/fingerprint-ledger.ts";
import { SnapshotArchive } from "./storage/snapshot-archive.ts";

export interface AppOptions {
  dataDir: string;
  baseUrl: string;
  logLevel: string;
  logFormat: LogFormat;
}

export class App {
  readonly client: CardmarketClient;
  readonly logger: Logger;
  private readonly options: AppOptions;

  constructor(options: AppOptions) {
    this.options = options;
    this.client = new CardmarketClient(options.baseUrl);
    this.logger = LoggerFactory.create(options.logLevel, options.logFormat);
  }

  /**
   * PostgreSQL / TimescaleDB connection URL, e.g. postgres://tcg:password@localhost:5432/tcg.
   * Only read from the environment, so the password never shows in a command line.
   */
  get databaseUrl(): string | undefined {
    return process.env.DATABASE_URL || undefined;
  }

  /** Reloads the ledger on each call: every collection starts from the state on disk. */
  async createCollector(): Promise<Collector> {
    const ledger = await FingerprintLedger.open(join(this.options.dataDir, "ledger.json"));
    return new Collector(this.client, ledger, this.archive(), this.logger);
  }

  /** Runs an import with a connected database, then closes the connection. */
  async withImporter<T>(task: (importer: PriceImporter) => Promise<T>): Promise<T> {
    if (!this.databaseUrl) throw new Error("No database: set DATABASE_URL");
    const database = await PriceDatabase.open(this.databaseUrl, this.logger);
    try {
      return await task(new PriceImporter(this.archive(), database, this.logger));
    } finally {
      await database.close();
    }
  }

  private archive(): SnapshotArchive {
    return new SnapshotArchive(join(this.options.dataDir, "archive"));
  }
}
