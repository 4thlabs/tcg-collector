// Wires the dependencies from the global options (data folder, Cardmarket URL, InfluxDB, logging).
import { join } from "node:path";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { Collector } from "./collect/collector.ts";
import { ImportLedger } from "./import/import-ledger.ts";
import { InfluxImporter } from "./import/influx-importer.ts";
import { InfluxWriter } from "./influx/influx-writer.ts";
import { LoggerFactory, type LogFormat, type Logger } from "./logging/logger-factory.ts";
import { FingerprintLedger } from "./storage/fingerprint-ledger.ts";
import { SnapshotArchive } from "./storage/snapshot-archive.ts";

export interface AppOptions {
  dataDir: string;
  baseUrl: string;
  influxUrl?: string;
  influxDatabase: string;
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

  /** True when an InfluxDB URL is configured: the schedule then imports after each collection. */
  get influxConfigured(): boolean {
    return Boolean(this.options.influxUrl);
  }

  /** Reloads the ledger on each call: every collection starts from the state on disk. */
  async createCollector(): Promise<Collector> {
    const ledger = await FingerprintLedger.open(join(this.options.dataDir, "ledger.json"));
    return new Collector(this.client, ledger, this.archive(), this.logger);
  }

  /** Runs an import with a connected client, then closes it. The token only comes from INFLUX_TOKEN, never the command line. */
  async withImporter<T>(task: (importer: InfluxImporter) => Promise<T>): Promise<T> {
    const { influxUrl, influxDatabase } = this.options;
    const token = process.env.INFLUX_TOKEN;
    if (!influxUrl) throw new Error("No InfluxDB URL: set --influx-url or INFLUX_URL");
    if (!token) throw new Error("No InfluxDB token: set INFLUX_TOKEN");
    const writer = new InfluxWriter({ url: influxUrl, database: influxDatabase, token });
    try {
      const ledger = await ImportLedger.open(join(this.options.dataDir, "import-ledger.json"));
      return await task(new InfluxImporter(this.archive(), ledger, writer, this.logger));
    } finally {
      await writer.close();
    }
  }

  private archive(): SnapshotArchive {
    return new SnapshotArchive(join(this.options.dataDir, "archive"));
  }
}
