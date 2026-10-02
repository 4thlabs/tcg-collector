// Wires the dependencies from the global options (data folder, Cardmarket URL, InfluxDB, logging).
import { join } from "node:path";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { Collector } from "./collect/collector.ts";
import { ImportLedger } from "./import/import-ledger.ts";
import { InfluxImporter } from "./import/influx-importer.ts";
import { InfluxReader } from "./influx/influx-reader.ts";
import { type InfluxSettings, InfluxWriter } from "./influx/influx-writer.ts";
import { LoggerFactory, type LogFormat, type Logger } from "./logging/logger-factory.ts";
import { FingerprintLedger } from "./storage/fingerprint-ledger.ts";
import { SnapshotArchive } from "./storage/snapshot-archive.ts";
import { CardCatalog } from "./web/card-catalog.ts";
import { WebServer } from "./web/web-server.ts";

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

  /** Runs an import with a connected client, then closes it. */
  async withImporter<T>(task: (importer: InfluxImporter) => Promise<T>): Promise<T> {
    const writer = new InfluxWriter(this.influxSettings());
    try {
      const ledger = await ImportLedger.open(join(this.options.dataDir, "import-ledger.json"));
      return await task(new InfluxImporter(this.archive(), ledger, writer, this.logger));
    } finally {
      await writer.close();
    }
  }

  /** Web server of the card page, reading InfluxDB for as long as the process runs. */
  createWebServer(): WebServer {
    return new WebServer(new CardCatalog(new InfluxReader(this.influxSettings())), this.logger);
  }

  /** The token only comes from INFLUX_TOKEN, never the command line. */
  private influxSettings(): InfluxSettings {
    const { influxUrl, influxDatabase } = this.options;
    const token = process.env.INFLUX_TOKEN;
    if (!influxUrl) throw new Error("No InfluxDB URL: set --influx-url or INFLUX_URL");
    if (!token) throw new Error("No InfluxDB token: set INFLUX_TOKEN");
    return { url: influxUrl, database: influxDatabase, token };
  }

  private archive(): SnapshotArchive {
    return new SnapshotArchive(join(this.options.dataDir, "archive"));
  }
}
