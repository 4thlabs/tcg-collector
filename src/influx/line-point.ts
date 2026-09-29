// One point in InfluxDB line protocol: measurement,tag=value field=value timestamp
// https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/

export class LinePoint {
  private readonly measurement: string;
  private readonly tags = new Map<string, string>();
  private readonly fields = new Map<string, number>();
  private readonly timestampSeconds: number;

  constructor(measurement: string, time: Date) {
    this.measurement = measurement;
    this.timestampSeconds = Math.floor(time.getTime() / 1000);
  }

  /** Adds a tag; empty values are skipped (line protocol does not allow them). */
  tag(key: string, value: string | number): this {
    const text = String(value);
    if (text !== "") this.tags.set(key, text);
    return this;
  }

  /** Adds a float field; null and undefined are skipped (a missing value, not zero). */
  field(key: string, value: number | null | undefined): this {
    if (value !== null && value !== undefined && Number.isFinite(value)) this.fields.set(key, value);
    return this;
  }

  /** A point needs at least one field to be written. */
  get isEmpty(): boolean {
    return this.fields.size === 0;
  }

  /** Line with a timestamp in seconds (the writer uses precision=s). Tags are sorted, as InfluxDB recommends. */
  toLine(): string {
    const tags = [...this.tags].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `,${LinePoint.escapeKey(key)}=${LinePoint.escapeKey(value)}`);
    // Always written as floats: a field keeps the type of its first write, and "12" would make it an integer.
    const fields = [...this.fields].map(([key, value]) => `${LinePoint.escapeKey(key)}=${Number.isInteger(value) ? `${value}.0` : value}`);
    return `${LinePoint.escapeKey(this.measurement)}${tags.join("")} ${fields.join(",")} ${this.timestampSeconds}`;
  }

  /** Tag keys, tag values and field keys escape commas, equal signs and spaces; line breaks are replaced. */
  private static escapeKey(text: string): string {
    return text.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/([, =])/g, "\\$1");
  }
}
