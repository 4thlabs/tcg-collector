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
    return join(this.folderOf(file), `${day}.json.gz`);
  }

  /** Writes the compressed raw file; a new collection on the same day replaces that day's archive. */
  async store(file: FeedFile, day: string, body: Buffer): Promise<StoredSnapshot> {
    const path = this.pathOf(file, day);
    const compressed = await gzipAsync(body, { level: constants.Z_BEST_COMPRESSION });
    await mkdir(this.folderOf(file), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, compressed);
    await rename(temporary, path);
    return { path, compressedSize: compressed.length };
  }

  /** Days (YYYY-MM-DD) archived for a file, oldest first; empty when nothing was archived yet. */
  async days(file: FeedFile): Promise<string[]> {
    try {
      const names = await readdir(this.folderOf(file));
      const archives = names.filter((name) => SnapshotArchive.archiveName.test(name));
      const days = archives.map((name) => name.slice(0, 10));
      return days.sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /** Decompressed and parsed content of one archive. */
  async read<T>(file: FeedFile, day: string): Promise<T> {
    const compressed = await readFile(this.pathOf(file, day));
    const body = await gunzipAsync(compressed);
    const text = body.toString("utf8");
    return JSON.parse(text) as T;
  }

  /** Folder of a file's archives: <root>/<type>/<game> */
  private folderOf(file: FeedFile): string {
    return join(this.root, file.kind.name, String(file.idGame));
  }
}
