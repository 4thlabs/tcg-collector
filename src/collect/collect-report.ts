// Collection summary: what happened to each file.

export type Outcome =
  /** New version archived. */
  | "archived"
  /** Same ETag as last time: nothing downloaded. */
  | "unchanged"
  /** File regenerated but useful content identical: downloaded, not archived. */
  | "same-content"
  /** The file does not exist for this game. */
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
      `Collection finished in ${seconds} s:`,
      `  ${this.count("archived")} archived (${(this.archivedBytes / 1e6).toFixed(1)} MB compressed)`,
      `  ${this.count("unchanged")} unchanged (same ETag), ${this.count("same-content")} regenerated without changes`,
      `  ${this.count("absent")} absent, ${this.count("failed")} failed`,
    ];
    for (const failure of this.failures) lines.push(`  failed ${failure.key}: ${failure.error}`);
    return lines.join("\n");
  }
}
