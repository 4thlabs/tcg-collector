// games: lists the games published by Cardmarket and their file sizes, without downloading anything.
// The table is the command's output, not a log, so it goes straight to stdout.
/* eslint-disable no-console */
import { Command } from "commander";
import type { App } from "../app.ts";
import type { CardmarketClient } from "../cardmarket/cardmarket-client.ts";
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

        console.log(["game", ...FeedKind.all.map((kind) => kind.name)].join("\t"));
        let total = 0;

        for (const idGame of GameSelection.parse(options.games).ids) {
          const sizes = await GamesCommand.fileSizes(client, idGame);

          // A game id without any file is not a published game.
          if (sizes.every((size) => size === undefined)) {
            continue;
          }

          for (const size of sizes) {
            total += size ?? 0;
          }

          console.log([idGame, ...sizes.map(GamesCommand.megabytes)].join("\t"));
        }

        console.log(`Uncompressed total: ${GamesCommand.megabytes(total)}`);
      });
  }

  /** Size in bytes of each file of a game, in the order of FeedKind.all; undefined for a file that does not exist. */
  private static async fileSizes(client: CardmarketClient, idGame: number): Promise<(number | undefined)[]> {
    const files = FeedKind.all.map((kind) => new FeedFile(kind, idGame));
    const versions = await Promise.all(files.map((file) => client.probe(file)));

    return versions.map((version) => version?.size);
  }

  /** "26.1 MB", or "-" for a missing file. */
  private static megabytes(bytes: number | undefined): string {
    return bytes === undefined ? "-" : `${(bytes / 1e6).toFixed(1)} MB`;
  }
}
