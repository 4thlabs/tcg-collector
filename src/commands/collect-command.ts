// collect: one immediate collection, then exit (code 1 if a file failed).
import { Command } from "commander";
import type { App } from "../app.ts";
import { GameSelection } from "../collect/game-selection.ts";

export class CollectCommand {
  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    program
      .command("collect")
      .description("collect the files of the requested games once")
      .option("-g, --games <ids>", 'games to collect: "all" or a list such as "1,6,21"', process.env.GAMES ?? "all")
      .action(async (options: { games: string }) => {
        const app = this.app();
        const report = await (await app.createCollector()).collect(GameSelection.parse(options.games));
        app.logger.info(report.summary());
        if (report.failures.length > 0) process.exitCode = 1;
      });
  }
}
