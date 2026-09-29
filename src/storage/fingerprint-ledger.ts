// Ledger of the last archived version of each file, persisted as JSON.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface LedgerEntry {
  /** S3 ETag of the last version seen: skips the download when nothing was regenerated. */
  etag: string;
  /** Fingerprint of the useful content of the last archived version. */
  fingerprint: string;
  /** Day (YYYY-MM-DD) of the last archive written. */
  archivedOn: string;
  /** ISO date of the last check. */
  checkedAt: string;
}

export class FingerprintLedger {
  private readonly path: string;
  private readonly entries: Map<string, LedgerEntry>;

  private constructor(path: string, entries: Map<string, LedgerEntry>) {
    this.path = path;
    this.entries = entries;
  }

  /** Loads the ledger, or creates an empty one on the first run. */
  static async open(path: string): Promise<FingerprintLedger> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, LedgerEntry>;
      return new FingerprintLedger(path, new Map(Object.entries(raw)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new FingerprintLedger(path, new Map());
      throw error;
    }
  }

  entry(key: string): LedgerEntry | undefined {
    return this.entries.get(key);
  }

  record(key: string, entry: LedgerEntry): void {
    this.entries.set(key, entry);
  }

  /** Atomic write (temporary file then rename) so the ledger is never left truncated. */
  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b)));
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sorted, null, 2)}\n`);
    await rename(temporary, this.path);
  }
}
