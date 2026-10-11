// HTTP server of the card page, on Hono: the static files of web/ and a small JSON API.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "../logging/logger-factory.ts";
import { ApiQuery } from "./api-query.ts";
import type { CardCatalog } from "./card-catalog.ts";
import type { CardImages } from "./card-images.ts";
import type { CatalogIndexes } from "./catalog-indexes.ts";

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
  /** Card images never change: browsers keep them a week. */
  private static readonly imageCacheSeconds = 7 * 24 * 60 * 60;

  private readonly parts: WebServerParts;
  /** The only files served: URL path -> file. Nothing else on disk is reachable. */
  private readonly files: Map<string, StaticFile>;
  private readonly server: ServerType;

  constructor(parts: WebServerParts) {
    this.parts = parts;
    this.files = new Map([
      ["/", { path: join(WebServer.webDir, "index.html"), type: "text/html; charset=utf-8" }],
      ["/style.css", { path: join(WebServer.webDir, "style.css"), type: "text/css; charset=utf-8" }],
      ["/app.js", { path: join(WebServer.webDir, "app.js"), type: "text/javascript; charset=utf-8" }],
      ["/vendor/chart.js", { path: WebServer.chartJsPath(), type: "text/javascript; charset=utf-8" }],
    ]);
    this.server = createAdaptorServer({ fetch: this.routes().fetch });
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

  private routes(): Hono {
    const { catalog, indexes, images, logger } = this.parts;
    const app = new Hono();

    app.use(async (c, next) => {
      if (c.req.method !== "GET") return c.json({ error: "Only GET is supported" }, 405);
      await next();
    });

    for (const [path, file] of this.files) {
      app.get(path, async (c) => {
        const bytes = await readFile(file.path);
        return c.body(bytes, 200, { "content-type": file.type, "cache-control": "no-cache" });
      });
    }

    // API answers change with every import: never cached. The image route sets its own header.
    app.use("/api/*", async (c, next) => {
      c.header("cache-control", "no-store");
      await next();
    });

    app.get("/api/search", async (c) => {
      const query = new ApiQuery(c.req.query());
      const game = query.id("game");
      const search = query.search();
      const index = await indexes.get(game);
      return c.json(index.find(search));
    });

    app.get("/api/card", async (c) => {
      const query = new ApiQuery(c.req.query());
      const game = query.id("game");
      const product = query.id("product");
      const index = await indexes.get(game);
      return c.json({ card: index.card(product) });
    });

    app.get("/api/expansions", async (c) => {
      const game = new ApiQuery(c.req.query()).id("game");
      const index = await indexes.get(game);
      return c.json({ expansions: index.expansions });
    });

    app.get("/api/latest", async (c) => {
      const game = new ApiQuery(c.req.query()).id("game");
      const day = await catalog.latestDay(game);
      return c.json({ day });
    });

    app.get("/api/prices", async (c) => {
      const query = new ApiQuery(c.req.query());
      const game = query.id("game");
      const product = query.id("product");
      const prices = await catalog.latestPrices(game, product);
      return c.json({ prices });
    });

    app.get("/api/daily", async (c) => {
      const query = new ApiQuery(c.req.query());
      const game = query.id("game");
      const product = query.id("product");
      const days = query.days();
      const prices = await catalog.dailyPrices(game, product, days);
      return c.json({ days: prices });
    });

    // The card's image, or 404 when it has none.
    app.get("/api/image", async (c) => {
      const query = new ApiQuery(c.req.query());
      const game = query.id("game");
      const product = query.id("product");
      const size = query.imageSize();
      const index = await indexes.get(game);
      const card = index.card(product);
      const image = card ? await images.get(game, card, size) : null;
      if (!image) return c.json({ error: "No image" }, 404);
      const cacheControl = `max-age=${WebServer.imageCacheSeconds}`;
      return c.body(image.bytes, 200, { "content-type": image.type, "cache-control": cacheControl });
    });

    app.notFound((c) => c.json({ error: "Not found" }, 404));

    // A refused parameter tells why; any other failure is logged and hidden behind a 500.
    app.onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
      logger.warn(`${c.req.path} failed: ${error.message}`);
      return c.json({ error: "The server could not answer" }, 500);
    });

    return app;
  }

  /** Chart.js's browser build, from the installed package (its exports only expose the module builds). */
  private static chartJsPath(): string {
    return join(dirname(fileURLToPath(import.meta.resolve("chart.js"))), "chart.umd.min.js");
  }
}
