// Bilan d'une collecte : ce qui s'est passé pour chaque fichier.

export type Outcome =
  /** Nouvelle version archivée. */
  | "archived"
  /** Même ETag que la dernière fois : rien téléchargé. */
  | "unchanged"
  /** Fichier régénéré mais contenu utile identique : téléchargé, pas archivé. */
  | "same-content"
  /** Le fichier n'existe pas pour ce jeu. */
  | "absent"
  | "failed";

interface FileResult {
  key: string;
  outcome: Outcome;
  bytes: number;
  error?: string;
}

export class CollectReport {
  private readonly results: FileResult[] = [];
  private readonly startedAt = Date.now();

  add(key: string, outcome: Outcome, bytes = 0, error?: string): void {
    this.results.push({ key, outcome, bytes, error });
  }

  count(outcome: Outcome): number {
    return this.results.filter((r) => r.outcome === outcome).length;
  }

  get failures(): readonly FileResult[] {
    return this.results.filter((r) => r.outcome === "failed");
  }

  get archivedBytes(): number {
    return this.results.filter((r) => r.outcome === "archived").reduce((sum, r) => sum + r.bytes, 0);
  }

  summary(): string {
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const lines = [
      `Collecte terminée en ${seconds} s :`,
      `  ${this.count("archived")} archivés (${(this.archivedBytes / 1e6).toFixed(1)} Mo compressés)`,
      `  ${this.count("unchanged")} inchangés (même ETag), ${this.count("same-content")} régénérés sans changement`,
      `  ${this.count("absent")} absents, ${this.count("failed")} en échec`,
    ];
    for (const failure of this.failures) lines.push(`  échec ${failure.key} : ${failure.error}`);
    return lines.join("\n");
  }
}
