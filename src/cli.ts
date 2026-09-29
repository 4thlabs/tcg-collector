#!/usr/bin/env node
// Point d'entrée : node src/cli.ts <commande> [options]
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
      .name("cardmarket-collector")
      .description("Collecte quotidienne des fichiers publics Cardmarket (Price Guide et catalogues)")
      .option("-d, --data-dir <dossier>", "dossier des archives et du registre", process.env.DATA_DIR ?? "data")
      .option("--base-url <url>", "adresse des fichiers Cardmarket", process.env.CARDMARKET_BASE_URL ?? CardmarketClient.defaultBaseUrl);

    // Les commandes lisent les options globales au moment de s'exécuter, après l'analyse de la ligne de commande.
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
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
