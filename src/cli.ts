#!/usr/bin/env node
// Entry point: node src/cli.ts <command> [options]
import { Command } from "commander";
import { App } from "./app.ts";
import { CardmarketClient } from "./cardmarket/cardmarket-client.ts";
import { CollectCommand } from "./commands/collect-command.ts";
import { GamesCommand } from "./commands/games-command.ts";
import { ScheduleCommand } from "./commands/schedule-command.ts";

class Cli {
  private readonly program = new Command();

  constructor() {
    this.program
      .name("tcg-collector")
      .description("Daily collection of Cardmarket's public files (price guide and catalogues)")
      .option("-d, --data-dir <folder>", "folder for the archives and the ledger", process.env.DATA_DIR ?? "data")
      .option("--base-url <url>", "base URL of the Cardmarket files", process.env.CARDMARKET_BASE_URL ?? CardmarketClient.defaultBaseUrl);

    // Commands read the global options when they run, after the command line has been parsed.
    const app = () => new App(this.program.opts<{ dataDir: string; baseUrl: string }>());
    for (const command of [new CollectCommand(app), new ScheduleCommand(app), new GamesCommand(app)]) command.register(this.program);
  }

  async run(argv: readonly string[]): Promise<void> {
    await this.program.parseAsync([...argv]);
  }
}

try {
  await new Cli().run(process.argv);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
