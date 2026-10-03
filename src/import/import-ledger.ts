// Last archive day imported into InfluxDB, per file (catalogues and price guides), kept in InfluxDB itself.
// The database is the only state of the import: a new or wiped database has no log, so the next import rebuilds it from the archives.
import { Point } from "@influxdata/influxdb3-client";
import type { InfluxReader } from "../influx/influx-reader.ts";

/**
 * Table "import_log", one point per imported file and day (timestamp: the archive day at 00:00 UTC).
 * Tags: game, file (e.g. "price_guide_21"). Field: points, the number of points written for that day.
 */
export class ImportLedger {
  static readonly table = "import_log";

  /** File key (e.g. "price_guide_21") -> last day imported (YYYY-MM-DD). */
  private readonly lastDays: Map<string, string>;

  private constructor(lastDays: Map<string, string>) {
    this.lastDays = lastDays;
  }

  /** Reads the last imported day of each file from the database; empty when the database or the table does not exist yet. */
  static async load(reader: InfluxReader): Promise<ImportLedger> {
    const lastDays = new Map<string, string>();
    try {
      const rows = await reader.query(`SELECT file, max(time) AS day FROM ${ImportLedger.table} GROUP BY file`);
      for (const row of rows) lastDays.set(String(row.file), new Date(Number(row.day)).toISOString().slice(0, 10));
    } catch (error) {
      if (!ImportLedger.isMissing(error)) throw error;
    }
    return new ImportLedger(lastDays);
  }

  lastDay(key: string): string | undefined {
    return this.lastDays.get(key);
  }

  /**
   * The log point of an imported day. The importer writes it in the same request as the day's last points
   * (a request costs about a second), so the day only counts as imported once all its points are written.
   */
  entry(key: string, idGame: number, day: string, points: number): Point {
    return Point.measurement(ImportLedger.table)
      .setTag("game", String(idGame))
      .setTag("file", key)
      .setIntegerField("points", points)
      .setTimestamp(new Date(`${day}T00:00:00Z`));
  }

  /** Remembers a day whose entry was written. */
  record(key: string, day: string): void {
    this.lastDays.set(key, day);
  }

  /**
   * InfluxDB 3 answers "database not found: …" before the first write, and "table '…' not found" before the first import.
   * Any other error (InfluxDB unreachable, bad token) stops the import rather than starting over from the first archive.
   */
  private static isMissing(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /database not found|table '[^']*' not found/.test(message);
  }
}
