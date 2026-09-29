// Writes points to InfluxDB 3 through the official client (@influxdata/influxdb3-client).
import { InfluxDBClient, type Point } from "@influxdata/influxdb3-client";

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

  private readonly client: InfluxDBClient;
  private readonly database: string;

  constructor(settings: InfluxSettings) {
    this.database = settings.database;
    this.client = new InfluxDBClient({
      host: settings.url,
      token: settings.token,
      database: settings.database,
      writeTimeout: 60_000,
      // /api/v3/write_lp (InfluxDB 3 Core), timestamps in seconds.
      writeOptions: { precision: "s", useV2Api: false },
    });
  }

  /** Writes the points by batches; returns the number of points written. */
  async write(points: readonly Point[]): Promise<number> {
    for (let start = 0; start < points.length; start += InfluxWriter.batchSize) {
      await this.client.write(points.slice(start, start + InfluxWriter.batchSize), this.database);
    }
    return points.length;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
