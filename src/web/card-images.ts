// Card images, fetched once from each game's image source and kept on disk, so the list never fetches an image twice.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CardEntry } from "./catalog-index.ts";
import type { ImageSource } from "./image-sources.ts";
import type { PoliteHttp } from "./polite-http.ts";

export type ImageSize = "small" | "normal";

export interface CardImage {
  bytes: Buffer;
  type: string;
}

export class CardImages {
  static readonly sizes: readonly ImageSize[] = ["small", "normal"];
  /** Image types kept, by file extension. */
  private static readonly types = new Map([
    ["jpg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ]);

  private readonly folder: string;
  private readonly http: PoliteHttp;
  /** Image source by Cardmarket game id. */
  private readonly sources: Map<string, ImageSource>;
  /** Requests in flight, so a card asked twice at once is fetched once. */
  private readonly pending = new Map<string, Promise<CardImage | null>>();

  constructor(folder: string, http: PoliteHttp, sources: Map<string, ImageSource>) {
    this.folder = folder;
    this.http = http;
    this.sources = sources;
  }

  /** The card's image, or null when its game has no image source or the source has no image for it. */
  async get(game: string, card: CardEntry, size: ImageSize): Promise<CardImage | null> {
    const source = this.sources.get(game);
    if (!source) return null;
    const key = `${game}/${size}/${card.product}`;
    const running = this.pending.get(key);
    if (running) return running;
    const loading = this.load(source, join(this.folder, game, size, card.product), card, size).finally(() => this.pending.delete(key));
    this.pending.set(key, loading);
    return loading;
  }

  /** `base` is the cache path without extension: base.jpg (or .png…) holds the image, base.none marks a card without image. */
  private async load(source: ImageSource, base: string, card: CardEntry, size: ImageSize): Promise<CardImage | null> {
    for (const [extension, type] of CardImages.types) {
      const bytes = await CardImages.readIfPresent(`${base}.${extension}`);
      if (bytes) return { bytes, type };
    }
    if (await CardImages.readIfPresent(`${base}.none`)) return null;

    const url = await source.imageUrl(card, size);
    const response = url ? await this.http.get(url, { headers: { accept: "image/*" } }) : null;
    const type = response?.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const extension = [...CardImages.types].find(([, known]) => known === type)?.[0];
    if (!response || response.status === 404 || !extension) {
      await CardImages.writeAtomically(`${base}.none`, Buffer.from("no image\n"));
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await CardImages.writeAtomically(`${base}.${extension}`, bytes);
    return { bytes, type };
  }

  private static async readIfPresent(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private static async writeAtomically(path: string, bytes: Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }
}
