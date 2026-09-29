// Writes points to InfluxDB 2.x through its HTTP API (/api/v2/write), with ky.
import ky, { type KyInstance } from "ky";
import type { LinePoint } from "./line-point.ts";

export interface InfluxSettings {
  /** e.g. http://influxdb:8086 */
  url: string;
  org: string;
  bucket: string;
  /** API token with write access to the bucket. */
  token: string;
}

export class InfluxWriter {
  /** Points per request: InfluxDB recommends batches of about 5,000 lines. */
  static readonly batchSize = 5_000;

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
      await this.http.post(`${this.settings.url.replace(/\/+$/, "")}/api/v2/write`, {
        searchParams: { org: this.settings.org, bucket: this.settings.bucket, precision: "s" },
        headers: { authorization: `Token ${this.settings.token}`, "content-type": "text/plain; charset=utf-8" },
        body: lines.join("\n"),
      });
    }
    return points.length;
  }
}
