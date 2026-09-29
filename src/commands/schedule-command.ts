// schedule : reste actif et collecte chaque jour à l'heure donnée (mode utilisé par Docker).
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
   * Par défaut 12:00 UTC : au 2026-09-29, Cardmarket publiait le Price Guide vers 01:00 UTC
   * et les catalogues vers 11:30 UTC ; une collecte à midi récupère les versions du jour.
   */
  static readonly defaultTime = "12:00";

  private readonly app: () => App;

  constructor(app: () => App) {
    this.app = app;
  }

  register(program: Command): void {
    program
      .command("schedule")
      .description("collecte tous les jours à heure fixe (UTC), sans s'arrêter")
      .option("-a, --at <HH:MM>", "heure de collecte, en UTC", process.env.COLLECT_AT ?? ScheduleCommand.defaultTime)
      .option("-g, --games <ids>", "jeux à collecter : « all » ou une liste « 1,6,21 »", process.env.GAMES ?? "all")
      .option("--run-now", "lance aussi une collecte immédiate au démarrage", false)
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
