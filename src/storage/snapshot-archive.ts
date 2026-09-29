// Archive of the collected files, gzip-compressed, organised by type, game and day.
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

  /** Archive path: <root>/<type>/<game>/<YYYY-MM-DD>.json.gz */
  pathOf(file: FeedFile, day: string): string {
    return join(this.root, file.kind.name, String(file.idGame), `${day}.json.gz`);
  }

  /** Writes the compressed raw file; a new collection on the same day replaces that day's archive. */
  async store(file: FeedFile, day: string, body: Buffer): Promise<StoredSnapshot> {
    const path = this.pathOf(file, day);
    const compressed = await gzipAsync(body, { level: constants.Z_BEST_COMPRESSION });
    await mkdir(join(this.root, file.kind.name, String(file.idGame)), { recursive: true });
    await writeFile(`${path}.tmp`, compressed);
    await rename(`${path}.tmp`, path);
    return { path, compressedSize: compressed.length };
  }
}
