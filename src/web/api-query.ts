// Query parameters of the card page's API, checked before anything is queried: a bad value is answered with 400.
import { HTTPException } from "hono/http-exception";
import { CardImages, type ImageSize } from "./card-images.ts";
import type { ProductKind, SearchRequest, SortOrder } from "./catalog-index.ts";

export class ApiQuery {
  static readonly maxDays = 3650;
  static readonly maxLimit = 200;
  private static readonly kinds: readonly ProductKind[] = ["all", "single", "sealed"];
  private static readonly sorts: readonly SortOrder[] = ["relevance", "trend-desc", "trend-asc", "newest"];

  /** One value per name, as Hono's `c.req.query()` gives them. */
  private readonly params: Record<string, string>;

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  /** Game, product and expansion ids are Cardmarket numbers. */
  id(name: string): string {
    const value = this.params[name] ?? "";
    if (!/^\d{1,9}$/.test(value)) throw ApiQuery.badRequest(`${name} must be a number`);
    return value;
  }

  /** Number of days of the price history: 90 by default. */
  days(): number {
    return this.integer("days", 1, ApiQuery.maxDays) ?? 90;
  }

  imageSize(): ImageSize {
    const size = this.params.size || "small";
    if (!CardImages.sizes.includes(size as ImageSize)) throw ApiQuery.badRequest("size must be small or normal");
    return size as ImageSize;
  }

  search(): SearchRequest {
    const text = (this.params.q ?? "").trim();
    if (text.length > 100) throw ApiQuery.badRequest("q must be at most 100 characters");
    return {
      text,
      kind: this.choice("kind", ApiQuery.kinds),
      sort: this.choice("sort", ApiQuery.sorts),
      expansionId: this.params.expansion ? Number(this.id("expansion")) : undefined,
      minTrend: this.price("min"),
      maxTrend: this.price("max"),
      offset: this.integer("offset", 0, 1_000_000) ?? 0,
      limit: this.integer("limit", 1, ApiQuery.maxLimit) ?? 60,
    };
  }

  /** One of the allowed values; the first one when absent or empty. */
  private choice<T extends string>(name: string, allowed: readonly T[]): T {
    const value = (this.params[name] || allowed[0]) as T;
    if (!allowed.includes(value)) throw ApiQuery.badRequest(`${name} must be one of ${allowed.join(", ")}`);
    return value;
  }

  /** Optional whole number within bounds; undefined when absent or empty. */
  private integer(name: string, min: number, max: number): number | undefined {
    const value = this.params[name];
    if (!value) return undefined;
    const number = Number(value);
    const inBounds = Number.isInteger(number) && number >= min && number <= max;
    if (!inBounds) throw ApiQuery.badRequest(`${name} must be a whole number from ${min} to ${max}`);
    return number;
  }

  /** Optional price in euros; undefined when absent or empty. */
  private price(name: string): number | undefined {
    const value = this.params[name];
    if (!value) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw ApiQuery.badRequest(`${name} must be a price in euros`);
    return number;
  }

  private static badRequest(message: string): HTTPException {
    return new HTTPException(400, { message });
  }
}
