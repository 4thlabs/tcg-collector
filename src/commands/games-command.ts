// games: lists the games published by Cardmarket and their file sizes, without downloading anything.
// The table is the command's output, not a log, so it goes straight to stdout.
import { Command } from "commander";
import type { App } from "../app.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import { GameSelection } from "../collect/game-selection.ts";

export class GamesCommand {
  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    program
      .command("games")
      .description("list the available games and the size of their files")
      .option("-g, --games <ids>", 'games to probe: "all" or a list such as "1,6,21"', "all")
      .action(async (options: { games: string }) => {
        const client = this.app().client;
        let total = 0;
        console.log(["game", ...FeedKind.all.map((k) => k.name)].join("\t"));
        for (const idGame of GameSelection.parse(options.games).ids) {
          const sizes = await Promise.all(FeedKind.all.map(async (kind) => (await client.probe(new FeedFile(kind, idGame)))?.size));
          if (sizes.every((size) => size === undefined)) continue;
          total += sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0);
          console.log([idGame, ...sizes.map((size) => (size === undefined ? "-" : `${(size / 1e6).toFixed(1)} MB`))].join("\t"));
        }
        console.log(`Uncompressed total: ${(total / 1e6).toFixed(1)} MB`);
      });
  }
}
