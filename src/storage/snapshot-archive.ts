// Archive des fichiers collectés, compressés en gzip, rangés par type, jeu et jour.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip, constants } from "node:zlib";
import type { FeedFile } from "../cardmarket/feed-file.ts";

const gzipAsync = promisify(gzip);

export interface StoredSnapshot {
  path: string;
  compressedSize: number;
}

export class SnapshotArchive {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Chemin d'une archive : <racine>/<type>/<jeu>/<AAAA-MM-JJ>.json.gz */
  pathOf(file: FeedFile, day: string): string {
    return join(this.root, file.kind.name, String(file.idGame), `${day}.json.gz`);
  }

  /** Écrit le fichier brut compressé ; une nouvelle collecte le même jour remplace l'archive du jour. */
  async store(file: FeedFile, day: string, body: Buffer): Promise<StoredSnapshot> {
    const path = this.pathOf(file, day);
    const compressed = await gzipAsync(body, { level: constants.Z_BEST_COMPRESSION });
    await mkdir(join(this.root, file.kind.name, String(file.idGame)), { recursive: true });
    await writeFile(`${path}.tmp`, compressed);
    await rename(`${path}.tmp`, path);
    return { path, compressedSize: compressed.length };
  }
}
