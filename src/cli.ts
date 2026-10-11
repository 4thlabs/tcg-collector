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
import { ErrorMessage } from "./logging/error-message.ts";
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
    // Each option falls back to its environment variable, then to a default.
    const defaults = {
      dataDir: process.env.DATA_DIR ?? "data",
      baseUrl: process.env.CARDMARKET_BASE_URL ?? CardmarketClient.defaultBaseUrl,
      influxUrl: process.env.INFLUX_URL,
      influxDatabase: process.env.INFLUX_DATABASE ?? "cardmarket",
      logLevel: process.env.LOG_LEVEL ?? "info",
      logFormat: process.env.LOG_FORMAT ?? "text",
    };
    const logLevel = new Option("--log-level <level>", "log level")
      .choices(LoggerFactory.levels)
      .default(defaults.logLevel);
    const logFormat = new Option("--log-format <format>", "log format")
      .choices(["text", "json"])
      .default(defaults.logFormat);

    this.program
      .name("tcg-collector")
      .description("Daily collection of Cardmarket's public files (price guide and catalogues)")
      .option("-d, --data-dir <folder>", "folder for the archives and the ledger", defaults.dataDir)
      .option("--base-url <url>", "base URL of the Cardmarket files", defaults.baseUrl)
      .option(
        "--influx-url <url>",
        "InfluxDB 3 URL, e.g. http://localhost:8181 (token: INFLUX_TOKEN)",
        defaults.influxUrl,
      )
      .option("--influx-database <name>", "InfluxDB database", defaults.influxDatabase)
      .addOption(logLevel)
      .addOption(logFormat);

    // Commands read the global options when they run, after the command line has been parsed.
    const app = () => new App(this.program.opts<GlobalOptions>());
    const commands = [
      new CollectCommand(app),
      new ScheduleCommand(app),
      new ImportCommand(app),
      new ServeCommand(app),
      new GamesCommand(app),
    ];
    for (const command of commands) {
      command.register(this.program);
    }
  }

  async run(argv: readonly string[]): Promise<void> {
    await this.program.parseAsync([...argv]);
  }
}

try {
  await new Cli().run(process.argv);
} catch (error) {
  LoggerFactory.create().error(ErrorMessage.of(error));
  process.exitCode = 1;
}
