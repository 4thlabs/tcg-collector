// Archive of the collected files, gzip-compressed, organised by type, game and day.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip, constants } from "node:zlib";
import type { FeedFile } from "../cardmarket/feed-file.ts";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface StoredSnapshot {
  path: string;
  compressedSize: number;
}

export class SnapshotArchive {
  /** Archive file name: the day, then .json.gz (temporary .tmp files are ignored). */
  private static readonly archiveName = /^\d{4}-\d{2}-\d{2}\.json\.gz$/;

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

  /** Days (YYYY-MM-DD) archived for a file, oldest first; empty when nothing was archived yet. */
  async days(file: FeedFile): Promise<string[]> {
    try {
      const names = await readdir(join(this.root, file.kind.name, String(file.idGame)));
      return names.filter((name) => SnapshotArchive.archiveName.test(name)).map((name) => name.slice(0, 10)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** Decompressed and parsed content of one archive. */
  async read<T>(file: FeedFile, day: string): Promise<T> {
    const body = await gunzipAsync(await readFile(this.pathOf(file, day)));
    return JSON.parse(body.toString("utf8")) as T;
  }
}
