// Card images, fetched once from each game's image source and kept on disk, so the list never fetches an image twice.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CardEntry } from "./catalog-index.ts";
import type { ImageSource } from "./image-sources.ts";
import type { PoliteHttp } from "./polite-http.ts";

export type ImageSize = "small" | "normal";

export interface CardImage {
  bytes: Buffer<ArrayBuffer>;
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
    if (!source) {
      return null;
    }
    const key = `${game}/${size}/${card.product}`;
    const running = this.pending.get(key);
    if (running) {
      return running;
    }
    const base = join(this.folder, game, size, card.product);
    const loading = this.load(source, base, card, size);
    this.pending.set(key, loading);
    try {
      return await loading;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * `base` is the cache path without extension: base.jpg (or .png…) holds the image,
   * base.none marks a card without image.
   */
  private async load(source: ImageSource, base: string, card: CardEntry, size: ImageSize): Promise<CardImage | null> {
    for (const [extension, type] of CardImages.types) {
      const bytes = await CardImages.readIfPresent(`${base}.${extension}`);
      if (bytes) {
        return { bytes, type };
      }
    }
    const knownWithoutImage = await CardImages.readIfPresent(`${base}.none`);
    if (knownWithoutImage) {
      return null;
    }

    const image = await this.download(source, card, size);
    if (image) {
      const extension = CardImages.extensionOf(image.type);
      await CardImages.writeAtomically(`${base}.${extension}`, image.bytes);
    } else {
      await CardImages.writeAtomically(`${base}.none`, Buffer.from("no image\n"));
    }
    return image;
  }

  /** The image from the game's source, or null when the source has none or answers with a type not kept here. */
  private async download(source: ImageSource, card: CardEntry, size: ImageSize): Promise<CardImage | null> {
    const url = await source.imageUrl(card, size);
    if (!url) {
      return null;
    }
    const response = await this.http.get(url, { headers: { accept: "image/*" } });
    if (response.status === 404) {
      return null;
    }
    // "image/jpeg; charset=…" -> "image/jpeg"
    const contentType = response.headers.get("content-type") ?? "";
    const type = contentType.split(";")[0].trim();
    if (!CardImages.extensionOf(type)) {
      return null;
    }
    const bytes = await response.arrayBuffer();
    return { bytes: Buffer.from(bytes), type };
  }

  /** File extension of an image type kept here, e.g. "jpg" for "image/jpeg"; undefined for any other type. */
  private static extensionOf(type: string): string | undefined {
    for (const [extension, known] of CardImages.types) {
      if (known === type) {
        return extension;
      }
    }
    return undefined;
  }

  private static async readIfPresent(path: string): Promise<Buffer<ArrayBuffer> | null> {
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
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
