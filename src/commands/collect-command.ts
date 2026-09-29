// collect : une collecte immédiate, puis sortie (code 1 si un fichier a échoué).
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
      .description("collecte une fois les fichiers de tous les jeux demandés")
      .option("-g, --games <ids>", "jeux à collecter : « all » ou une liste « 1,6,21 »", process.env.GAMES ?? "all")
      .action(async (options: { games: string }) => {
        const report = await (await this.app().createCollector()).collect(GameSelection.parse(options.games));
        console.log(report.summary());
        if (report.failures.length > 0) process.exitCode = 1;
      });
  }
}
