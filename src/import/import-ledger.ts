// Last archive day imported into InfluxDB, per file (catalogues and price guides), persisted as JSON.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class ImportLedger {
  private readonly path: string;
  /** File key (e.g. "price_guide_21") -> last day imported (YYYY-MM-DD). */
  private readonly lastDays: Map<string, string>;

  private constructor(path: string, lastDays: Map<string, string>) {
    this.path = path;
    this.lastDays = lastDays;
  }

  /** Loads the ledger, or creates an empty one on the first import. */
  static async open(path: string): Promise<ImportLedger> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
      return new ImportLedger(path, new Map(Object.entries(raw)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new ImportLedger(path, new Map());
      throw error;
    }
  }

  lastDay(key: string): string | undefined {
    return this.lastDays.get(key);
  }

  record(key: string, day: string): void {
    this.lastDays.set(key, day);
  }

  /** Atomic write (temporary file then rename) so the ledger is never left truncated. */
  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries([...this.lastDays].sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(`${this.path}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
    await rename(`${this.path}.tmp`, this.path);
  }
}
