// Registre de la dernière version archivée de chaque fichier, persisté en JSON.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface LedgerEntry {
  /** ETag S3 de la dernière version vue : permet d'éviter un téléchargement si rien n'a été régénéré. */
  etag: string;
  /** Empreinte du contenu utile de la dernière version archivée. */
  fingerprint: string;
  /** Jour (AAAA-MM-JJ) de la dernière archive écrite. */
  archivedOn: string;
  /** Date ISO de la dernière vérification. */
  checkedAt: string;
}

export class FingerprintLedger {
  private readonly path: string;
  private readonly entries: Map<string, LedgerEntry>;

  private constructor(path: string, entries: Map<string, LedgerEntry>) {
    this.path = path;
    this.entries = entries;
  }

  /** Charge le registre, ou en crée un vide au premier lancement. */
  static async open(path: string): Promise<FingerprintLedger> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, LedgerEntry>;
      return new FingerprintLedger(path, new Map(Object.entries(raw)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new FingerprintLedger(path, new Map());
      throw error;
    }
  }

  entry(key: string): LedgerEntry | undefined {
    return this.entries.get(key);
  }

  record(key: string, entry: LedgerEntry): void {
    this.entries.set(key, entry);
  }

  /** Écriture atomique (fichier temporaire puis renommage) pour ne jamais laisser un registre tronqué. */
  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b)));
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sorted, null, 2)}\n`);
    await rename(temporary, this.path);
  }
}
