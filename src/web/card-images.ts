// Card images, fetched once from Scryfall (Magic only) and kept on disk, so the list never hits Scryfall twice.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ky, { type KyInstance } from "ky";

export type ImageSize = "small" | "normal";

export class CardImages {
  static readonly sizes: readonly ImageSize[] = ["small", "normal"];
  /** Scryfall asks for 50 to 100 ms between requests. */
  static readonly spacingMs = 100;

  private readonly folder: string;
  private readonly http: KyInstance;
  /** Requests in flight, so a card asked twice at once is fetched once. */
  private readonly pending = new Map<string, Promise<Buffer | null>>();
  /** End of the last request slot: requests start one after another, spacingMs apart. */
  private nextSlot = 0;

  constructor(folder: string, http?: KyInstance) {
    this.folder = folder;
    this.http =
      http ??
      ky.create({
        timeout: 20_000,
        // Scryfall requires an identifying User-Agent and an Accept header.
        headers: { "user-agent": "tcg-collector (https://github.com/4thlabs/tcg-collector)", accept: "image/*" },
        retry: { limit: 2, statusCodes: [429, 500, 502, 503, 504] },
      });
  }

  /** JPEG bytes of a card's image, or null when the game has no image source or the card has no image. */
  async get(game: string, product: string, size: ImageSize): Promise<Buffer | null> {
    if (game !== "1") return null;
    const key = `${game}/${size}/${product}`;
    const running = this.pending.get(key);
    if (running) return running;
    const loading = this.load(game, product, size).finally(() => this.pending.delete(key));
    this.pending.set(key, loading);
    return loading;
  }

  private async load(game: string, product: string, size: ImageSize): Promise<Buffer | null> {
    const path = join(this.folder, game, size, `${product}.jpg`);
    const missing = join(this.folder, game, size, `${product}.none`);
    const cached = await CardImages.readIfPresent(path);
    if (cached) return cached;
    if (await CardImages.readIfPresent(missing)) return null;

    await this.waitForSlot();
    // Scryfall finds Magic cards by their Cardmarket idProduct and redirects to the image.
    const response = await this.http.get(`https://api.scryfall.com/cards/cardmarket/${product}`, {
      searchParams: { format: "image", version: size },
      throwHttpErrors: (status) => status !== 404,
    });
    if (response.status === 404) {
      await CardImages.writeAtomically(missing, Buffer.from("no image on Scryfall\n"));
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await CardImages.writeAtomically(path, bytes);
    return bytes;
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + CardImages.spacingMs;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
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
