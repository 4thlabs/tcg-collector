// import: writes the archived price guides into the database (only the days not imported yet, unless --replay).
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
    program
      .command("import")
      .description("import the archived price guides into the TimescaleDB database (DATABASE_URL)")
      .option("-g, --games <ids>", 'games to import: "all" or a list such as "1,6,21"', process.env.IMPORT_GAMES ?? process.env.GAMES ?? "all")
      .option("--replay", "import every archive again, not only the new ones", false)
      .action(async (options: ImportOptions) => {
        await this.app().withImporter((importer) => importer.import(GameSelection.parse(options.games), options.replay));
      });
  }
}
