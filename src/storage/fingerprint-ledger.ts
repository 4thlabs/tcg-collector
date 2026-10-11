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
      const text = await readFile(path, "utf8");
      const saved = JSON.parse(text) as Record<string, LedgerEntry>;
      const entries = new Map(Object.entries(saved));
      return new FingerprintLedger(path, entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new FingerprintLedger(path, new Map());
      }
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
    // Keys in order, so two saves of the same entries give the same file.
    const keys = [...this.entries.keys()].sort((a, b) => a.localeCompare(b));
    const sorted = Object.fromEntries(keys.map((key) => [key, this.entries.get(key)]));
    const text = `${JSON.stringify(sorted, null, 2)}\n`;
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, this.path);
  }
}
