// Runs SQL queries on InfluxDB 3 through the official client (@influxdata/influxdb3-client, Flight SQL).
import { InfluxDBClient } from "@influxdata/influxdb3-client";
import type { InfluxSettings } from "./influx-writer.ts";

/** One result row: column name -> value. Times come back as milliseconds since the epoch, nulls as null. */
export type Row = Record<string, unknown>;

/** Query parameters, referenced as $name in the SQL. */
export type QueryParams = Record<string, string | number | boolean>;

export class InfluxReader {
  private readonly client: InfluxDBClient;
  private readonly database: string;

  constructor(settings: InfluxSettings) {
    this.database = settings.database;
    this.client = new InfluxDBClient({ host: settings.url, token: settings.token, database: settings.database });
  }

  /** All the rows of a SQL query. Values from outside always go through params, never into the SQL text. */
  async query(sql: string, params: QueryParams = {}): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const row of this.client.query(sql, this.database, { type: "sql", params })) rows.push(row);
    return rows;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
