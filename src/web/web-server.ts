// HTTP server of the card page: the static files of web/ and a small JSON API over the card catalog (node:http, no framework).
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logging/logger-factory.ts";
import type { CardCatalog } from "./card-catalog.ts";

/** A request the API refuses, answered with status 400. */
class BadRequest extends Error {}

interface StaticFile {
  path: string;
  type: string;
}

export class WebServer {
  /** Folder of the page's HTML, CSS and JavaScript, at the root of the repository. */
  static readonly webDir = fileURLToPath(new URL("../../web/", import.meta.url));
  static readonly maxDays = 3650;

  private readonly catalog: CardCatalog;
  private readonly logger: Logger;
  private readonly server: Server;
  /** The only files served: URL path -> file. Nothing else on disk is reachable. */
  private readonly files: Map<string, StaticFile>;

  constructor(catalog: CardCatalog, logger: Logger) {
    this.catalog = catalog;
    this.logger = logger;
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
      if (request.method !== "GET") return this.send(response, 405, { error: "Only GET is supported" });
      if (url.pathname.startsWith("/api/")) return this.send(response, 200, await this.api(url));
      const file = this.files.get(url.pathname);
      if (!file) return this.send(response, 404, { error: "Not found" });
      response.writeHead(200, { "content-type": file.type, "cache-control": "no-cache" });
      response.end(await readFile(file.path));
    } catch (error) {
      if (error instanceof BadRequest) return this.send(response, 400, { error: error.message });
      this.logger.warn(`${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.send(response, 500, { error: "The price database could not answer" });
    }
  }

  /** /api/search?game&q, /api/prices?game&product, /api/daily?game&product&days */
  private async api(url: URL): Promise<unknown> {
    const query = url.searchParams;
    const game = WebServer.id(query, "game");
    switch (url.pathname) {
      case "/api/search": {
        const text = (query.get("q") ?? "").trim();
        if (text.length < 3 || text.length > 100) throw new BadRequest("q must be 3 to 100 characters");
        return { cards: await this.catalog.search(game, text) };
      }
      case "/api/prices":
        return { prices: await this.catalog.latestPrices(game, WebServer.id(query, "product")) };
      case "/api/daily": {
        const days = Number(query.get("days") ?? 90);
        if (!Number.isInteger(days) || days < 1 || days > WebServer.maxDays) throw new BadRequest(`days must be 1 to ${WebServer.maxDays}`);
        return { days: await this.catalog.dailyPrices(game, WebServer.id(query, "product"), days) };
      }
      default:
        throw new BadRequest(`Unknown API: ${url.pathname}`);
    }
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }

  /** Game and product ids are Cardmarket numbers. */
  private static id(query: URLSearchParams, name: string): string {
    const value = query.get(name) ?? "";
    if (!/^\d{1,9}$/.test(value)) throw new BadRequest(`${name} must be a number`);
    return value;
  }

  /** Chart.js's browser build, from the installed package (its exports only expose the module builds). */
  private static chartJsPath(): string {
    return join(dirname(fileURLToPath(import.meta.resolve("chart.js"))), "chart.umd.min.js");
  }
}
