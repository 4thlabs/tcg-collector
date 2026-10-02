// HTTP client for the image sites: identifies itself and spaces its requests, as Scryfall asks.
import ky, { type KyInstance, type Options } from "ky";

export class PoliteHttp {
  /** Scryfall asks for 50 to 100 ms between requests; the same pace is used everywhere. */
  static readonly spacingMs = 100;

  private readonly http: KyInstance;
  private readonly spacingMs: number;
  /** End of the last request slot: requests start one after another, spacingMs apart. */
  private nextSlot = 0;

  constructor(http?: KyInstance, spacingMs = PoliteHttp.spacingMs) {
    this.spacingMs = spacingMs;
    this.http =
      http ??
      ky.create({
        timeout: 20_000,
        // Scryfall requires an identifying User-Agent and an Accept header.
        headers: { "user-agent": "tcg-collector (https://github.com/4thlabs/tcg-collector)" },
        retry: { limit: 2, statusCodes: [429, 500, 502, 503, 504] },
      });
  }

  /** GET once a request slot is free; 404 is an answer, not an error. */
  async get(url: string, options: Options = {}): Promise<Response> {
    await this.waitForSlot();
    return this.http.get(url, { ...options, throwHttpErrors: (status) => status !== 404 });
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.spacingMs;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  }
}
