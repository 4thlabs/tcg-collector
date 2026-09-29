// Writes points to InfluxDB 3 through its HTTP API (/api/v3/write_lp), with ky.
import ky, { type KyInstance } from "ky";
import type { LinePoint } from "./line-point.ts";

export interface InfluxSettings {
  /** e.g. http://influxdb:8181 */
  url: string;
  /** Database, created by InfluxDB on the first write. */
  database: string;
  /** Token with write access to the database. */
  token: string;
}

export class InfluxWriter {
  /**
   * Points per request. InfluxDB 3 acknowledges a write once its WAL is flushed (every second by default),
   * so each request costs about a second: large batches keep a Magic day (~126,000 points) to a few requests.
   * 25,000 lines stay around 5 MB, under the 10 MB default request limit.
   */
  static readonly batchSize = 25_000;

  private readonly settings: InfluxSettings;
  private readonly http: KyInstance;

  constructor(settings: InfluxSettings, attempts = 3, retryDelayMs = 5_000) {
    this.settings = settings;
    this.http = ky.create({
      timeout: 60_000,
      // POST is not retried by default; a write is idempotent here (same series and time overwrite).
      retry: {
        limit: attempts - 1,
        methods: ["post"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        delay: (attempt) => retryDelayMs * attempt,
        retryOnTimeout: true,
      },
    });
  }

  /** Writes the points by batches; returns the number of points written. */
  async write(points: readonly LinePoint[]): Promise<number> {
    for (let start = 0; start < points.length; start += InfluxWriter.batchSize) {
      const lines = points.slice(start, start + InfluxWriter.batchSize).map((point) => point.toLine());
      await this.http.post(`${this.settings.url.replace(/\/+$/, "")}/api/v3/write_lp`, {
        searchParams: { db: this.settings.database, precision: "second" },
        headers: { authorization: `Bearer ${this.settings.token}`, "content-type": "text/plain; charset=utf-8" },
        body: lines.join("\n"),
      });
    }
    return points.length;
  }
}
