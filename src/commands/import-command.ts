// import: writes the archived catalogues and price guides into InfluxDB.
// Only the days not imported yet, unless --replay.
import { Command } from "commander";
import type { App } from "../app.ts";
import { GameSelection } from "../collect/game-selection.ts";

interface ImportOptions {
  games: string;
  replay: boolean;
}

export class ImportCommand {
  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    // The games collected by default are also the games imported by default.
    const defaultGames = process.env.IMPORT_GAMES ?? process.env.GAMES;

    program
      .command("import")
      .description("import the archived catalogues and price guides into InfluxDB")
      .option("-g, --games <ids>", 'games to import: "all" or a list such as "1,6,21"', defaultGames ?? "all")
      .option("--replay", "import every archive again, not only the new ones", false)
      .action(async (options: ImportOptions) => {
        const games = GameSelection.parse(options.games);

        await this.app().withImporter((importer) => importer.import(games, options.replay));
      });
  }
}
