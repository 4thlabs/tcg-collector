#!/usr/bin/env node
// Entry point: node src/cli.ts <command> [options]
import { Command, Option } from "commander";
import { App } from "./app.ts";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { CollectCommand } from "./commands/collect-command.ts";
import { GamesCommand } from "./commands/games-command.ts";
import { ImportCommand } from "./commands/import-command.ts";
import { ScheduleCommand } from "./commands/schedule-command.ts";
import { ServeCommand } from "./commands/serve-command.ts";
import { type LogFormat, LoggerFactory } from "./logging/logger-factory.ts";

interface GlobalOptions {
  dataDir: string;
  baseUrl: string;
  influxUrl?: string;
  influxDatabase: string;
  logLevel: string;
  logFormat: LogFormat;
}

class Cli {
  private readonly program = new Command();

  constructor() {
    this.program
      .name("tcg-collector")
      .description("Daily collection of Cardmarket's public files (price guide and catalogues)")
      .option("-d, --data-dir <folder>", "folder for the archives and the ledger", process.env.DATA_DIR ?? "data")
      .option("--base-url <url>", "base URL of the Cardmarket files", process.env.CARDMARKET_BASE_URL ?? CardmarketClient.defaultBaseUrl)
      .option("--influx-url <url>", "InfluxDB 3 URL, e.g. http://localhost:8181 (token: INFLUX_TOKEN)", process.env.INFLUX_URL)
      .option("--influx-database <name>", "InfluxDB database", process.env.INFLUX_DATABASE ?? "cardmarket")
      .addOption(new Option("--log-level <level>", "log level").choices(LoggerFactory.levels).default(process.env.LOG_LEVEL ?? "info"))
      .addOption(new Option("--log-format <format>", "log format").choices(["text", "json"]).default(process.env.LOG_FORMAT ?? "text"));

    // Commands read the global options when they run, after the command line has been parsed.
    const app = () => new App(this.program.opts<GlobalOptions>());
    for (const command of [new CollectCommand(app), new ScheduleCommand(app), new ImportCommand(app), new ServeCommand(app), new GamesCommand(app)]) command.register(this.program);
  }

  async run(argv: readonly string[]): Promise<void> {
    await this.program.parseAsync([...argv]);
  }
}

try {
  await new Cli().run(process.argv);
} catch (error) {
  LoggerFactory.create().error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
