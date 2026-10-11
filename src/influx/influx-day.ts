// Days in InfluxDB: every point of an archive day is stamped at 00:00 UTC of that day.

export class InfluxDay {
  /** Timestamp of the points of an archive day (YYYY-MM-DD). */
  static start(day: string): Date {
    return new Date(`${day}T00:00:00Z`);
  }

  /** Day (YYYY-MM-DD) of a time read back from InfluxDB, which gives milliseconds since the epoch. */
  static of(time: unknown): string {
    return new Date(Number(time)).toISOString().slice(0, 10);
  }
}
