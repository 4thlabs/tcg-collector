// HTTP server of the card page: the static files of web/ and a small JSON API (node:http, no framework).
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logging/logger-factory.ts";
import type { CardCatalog } from "./card-catalog.ts";
import type { CardImages, ImageSize } from "./card-images.ts";
import type { ProductKind, SearchRequest, SortOrder } from "./catalog-index.ts";
import type { CatalogIndexes } from "./catalog-indexes.ts";

/** A request the API refuses, answered with status 400. */
class BadRequest extends Error {}

interface StaticFile {
  path: string;
  type: string;
}

/** What the server needs to answer the API. */
export interface WebServerParts {
  catalog: CardCatalog;
  indexes: CatalogIndexes;
  images: CardImages;
  logger: Logger;
}

export class WebServer {
  /** Folder of the page's HTML, CSS and JavaScript, at the root of the repository. */
  static readonly webDir = fileURLToPath(new URL("../../web/", import.meta.url));
  static readonly maxDays = 3650;
  static readonly maxLimit = 200;
  private static readonly kinds: readonly ProductKind[] = ["all", "single", "sealed"];
  private static readonly sorts: readonly SortOrder[] = ["relevance", "trend-desc", "trend-asc", "newest"];

  private readonly parts: WebServerParts;
  private readonly server: Server;
  /** The only files served: URL path -> file. Nothing else on disk is reachable. */
  private readonly files: Map<string, StaticFile>;

  constructor(parts: WebServerParts) {
    this.parts = parts;
    this.files = new Map([
      ["/", { path: join(WebServer.webDir, "index.html"), type: "text/html; charset=utf-8" }],
      ["/style.css", { path: join(WebServer.webDir, "style.css"), type: "text/css; charset=utf-8" }],
      ["/app.js", { path: join(WebServer.webDir, "app.js"), type: "text/javascript; charset=utf-8" }],
      ["/vendor/chart.js", { path: WebServer.chartJsPath(), type: "text/javascript; charset=utf-8" }],
    ]);
    this.server = createServer((request, response) => void this.handle(request, response));
  }

  /** Starts listening; resolves with the port actually used (useful with port 0). */
  listen(port: number, host?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        const address = this.server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => this.server.close((error) => (error ? reject(error) : resolve())));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method !== "GET") return this.sendJson(response, 405, { error: "Only GET is supported" });
      if (url.pathname === "/api/image") return await this.image(url.searchParams, response);
      if (url.pathname.startsWith("/api/")) return this.sendJson(response, 200, await this.api(url));
      const file = this.files.get(url.pathname);
      if (!file) return this.sendJson(response, 404, { error: "Not found" });
      response.writeHead(200, { "content-type": file.type, "cache-control": "no-cache" });
      response.end(await readFile(file.path));
    } catch (error) {
      if (error instanceof BadRequest) return this.sendJson(response, 400, { error: error.message });
      this.parts.logger.warn(`${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.sendJson(response, 500, { error: "The server could not answer" });
    }
  }

  /** JSON routes: search, card, expansions, prices, daily. */
  private async api(url: URL): Promise<unknown> {
    const query = url.searchParams;
    const game = WebServer.id(query, "game");
    switch (url.pathname) {
      case "/api/search":
        return (await this.parts.indexes.get(game)).find(WebServer.searchRequest(query));
      case "/api/card":
        return { card: (await this.parts.indexes.get(game)).card(WebServer.id(query, "product")) };
      case "/api/expansions":
        return { expansions: (await this.parts.indexes.get(game)).expansions };
      case "/api/prices":
        return { prices: await this.parts.catalog.latestPrices(game, WebServer.id(query, "product")) };
      case "/api/daily": {
        const days = WebServer.integer(query, "days", 1, WebServer.maxDays) ?? 90;
        return { days: await this.parts.catalog.dailyPrices(game, WebServer.id(query, "product"), days) };
      }
      default:
        throw new BadRequest(`Unknown API: ${url.pathname}`);
    }
  }

  /** /api/image?game&product&size: the card's JPEG, or 404 when it has none. Images never change: cached a week. */
  private async image(query: URLSearchParams, response: ServerResponse): Promise<void> {
    const size = query.get("size") ?? "small";
    if (!(["small", "normal"] as const).includes(size as ImageSize)) throw new BadRequest("size must be small or normal");
    const bytes = await this.parts.images.get(WebServer.id(query, "game"), WebServer.id(query, "product"), size as ImageSize);
    if (!bytes) return this.sendJson(response, 404, { error: "No image" });
    response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=604800" });
    response.end(bytes);
  }

  private static searchRequest(query: URLSearchParams): SearchRequest {
    const text = (query.get("q") ?? "").trim();
    if (text.length > 100) throw new BadRequest("q must be at most 100 characters");
    const kind = (query.get("kind") || "all") as ProductKind;
    if (!WebServer.kinds.includes(kind)) throw new BadRequest(`kind must be one of ${WebServer.kinds.join(", ")}`);
    const sort = (query.get("sort") || "relevance") as SortOrder;
    if (!WebServer.sorts.includes(sort)) throw new BadRequest(`sort must be one of ${WebServer.sorts.join(", ")}`);
    const expansion = query.get("expansion");
    return {
      text,
      kind,
      sort,
      expansionId: expansion ? Number(WebServer.id(query, "expansion")) : undefined,
      minTrend: WebServer.price(query, "min"),
      maxTrend: WebServer.price(query, "max"),
      offset: WebServer.integer(query, "offset", 0, 1_000_000) ?? 0,
      limit: WebServer.integer(query, "limit", 1, WebServer.maxLimit) ?? 60,
    };
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }

  /** Game, product and expansion ids are Cardmarket numbers. */
  private static id(query: URLSearchParams, name: string): string {
    const value = query.get(name) ?? "";
    if (!/^\d{1,9}$/.test(value)) throw new BadRequest(`${name} must be a number`);
    return value;
  }

  /** Optional whole number within bounds; undefined when absent or empty. */
  private static integer(query: URLSearchParams, name: string, min: number, max: number): number | undefined {
    const value = query.get(name);
    if (!value) return undefined;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new BadRequest(`${name} must be a whole number from ${min} to ${max}`);
    return number;
  }

  /** Optional price in euros; undefined when absent or empty. */
  private static price(query: URLSearchParams, name: string): number | undefined {
    const value = query.get(name);
    if (!value) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequest(`${name} must be a price in euros`);
    return number;
  }

  /** Chart.js's browser build, from the installed package (its exports only expose the module builds). */
  private static chartJsPath(): string {
    return join(dirname(fileURLToPath(import.meta.resolve("chart.js"))), "chart.umd.min.js");
  }
}
