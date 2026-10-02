// serve: web page to search a card and see its prices, read from InfluxDB (mode used by the tcg-collector-web container).
import { Command } from "commander";
import type { App } from "../app.ts";

interface ServeOptions {
  port: string;
  host: string;
}

export class ServeCommand {
  static readonly defaultPort = "8080";

  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    program
      .command("serve")
      .description("serve the card page: search a card, see its latest and daily prices")
      .option("-p, --port <port>", "HTTP port", process.env.PORT ?? ServeCommand.defaultPort)
      .option("--host <address>", "address to listen on", process.env.HOST ?? "0.0.0.0")
      .action(async (options: ServeOptions) => {
        const app = this.app();
        const server = app.createWebServer();
        const port = await server.listen(Number(options.port), options.host);
        app.logger.info(`card page on http://${options.host}:${port}/`);
      });
  }
}
