// Assemble les dépendances à partir des options communes (dossier de données, URL de Cardmarket).
import { join } from "node:path";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { Collector } from "./collect/collector.ts";
import { FingerprintLedger } from "./storage/fingerprint-ledger.ts";
import { SnapshotArchive } from "./storage/snapshot-archive.ts";

export interface AppOptions {
  dataDir: string;
  baseUrl: string;
}

export class App {
  readonly client: CardmarketClient;
  private readonly dataDir: string;

  constructor(options: AppOptions) {
    this.dataDir = options.dataDir;
    this.client = new CardmarketClient(options.baseUrl);
  }

  /** Relit le registre à chaque appel : chaque collecte part de l'état sur disque. */
  async createCollector(): Promise<Collector> {
    const ledger = await FingerprintLedger.open(join(this.dataDir, "ledger.json"));
    return new Collector(this.client, ledger, new SnapshotArchive(join(this.dataDir, "archive")));
  }
}
