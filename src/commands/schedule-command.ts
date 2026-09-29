// schedule: stays up and collects every day at the given time (mode used by Docker).
// When DATABASE_URL is set, each collection is followed by an import of the new price guides.
import { Command } from "commander";
import type { App } from "../app.ts";
import { DailyScheduler } from "../collect/daily-scheduler.ts";
import { GameSelection } from "../collect/game-selection.ts";

interface ScheduleOptions {
  at: string;
  games: string;
  importGames?: string;
  runNow: boolean;
}

export class ScheduleCommand {
  /**
   * 12:00 UTC by default: as of 2026-09-29, Cardmarket published the price guide around 01:00 UTC
   * and the catalogues around 11:30 UTC; a midday collection gets both of the day's versions.
   */
  static readonly defaultTime = "12:00";

  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    program
      .command("schedule")
      .description("collect every day at a fixed time (UTC), without stopping")
      .option("-a, --at <HH:MM>", "collection time, in UTC", process.env.COLLECT_AT ?? ScheduleCommand.defaultTime)
      .option("-g, --games <ids>", 'games to collect: "all" or a list such as "1,6,21"', process.env.GAMES ?? "all")
      .option("--import-games <ids>", "games to import into the database after each collection (default: the collected games)", process.env.IMPORT_GAMES)
      .option("--run-now", "also run a collection immediately on start", false)
      .action(async (options: ScheduleOptions) => {
        const app = this.app();
        const games = GameSelection.parse(options.games);
        const importGames = options.importGames ? GameSelection.parse(options.importGames) : games;
        const collect = async () => {
          const report = await (await app.createCollector()).collect(games);
          app.logger.info(report.summary());
          if (app.databaseUrl) await app.withImporter((importer) => importer.import(importGames));
        };
        const scheduler = new DailyScheduler(options.at, collect, app.logger);
        if (options.runNow) await scheduler.runOnce();
        await scheduler.runForever();
      });
  }
}
