// schedule: stays up and collects every day at the given time (mode used by Docker).
import { Command } from "commander";
import type { App } from "../app.ts";
import { DailyScheduler } from "../collect/daily-scheduler.ts";
import { GameSelection } from "../collect/game-selection.ts";

interface ScheduleOptions {
  at: string;
  games: string;
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
      .option("--run-now", "also run a collection immediately on start", false)
      .action(async (options: ScheduleOptions) => {
        const games = GameSelection.parse(options.games);
        const scheduler = new DailyScheduler(options.at, async () => {
          const report = await (await this.app().createCollector()).collect(games);
          console.log(report.summary());
        });
        if (options.runNow) await scheduler.runOnce();
        await scheduler.runForever();
      });
  }
}
