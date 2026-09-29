// Product names and expansions, from the archived catalogues of a game.
import type { ProductEntry, ProductListContent } from "../cardmarket/feed-content.ts";
import { FeedFile, FeedKind } from "../cardmarket/feed-file.ts";
import type { SnapshotArchive } from "../storage/snapshot-archive.ts";

export class ProductCatalog {
  static readonly empty = new ProductCatalog([]);

  private readonly products: Map<number, ProductEntry>;

  constructor(products: readonly ProductEntry[]) {
    this.products = new Map(products.map((product) => [product.idProduct, product]));
  }

  get size(): number {
    return this.products.size;
  }

  product(idProduct: number): ProductEntry | undefined {
    return this.products.get(idProduct);
  }
}

/**
 * Loads the catalogue in force on a given day: for each catalogue file, the latest archive on or before that day
 * (catalogues are only archived when they change), or the oldest one when the prices predate every catalogue.
 * The last catalogue built is kept, since consecutive days almost always share it.
 */
export class CatalogLoader {
  private readonly archive: SnapshotArchive;
  private cached?: { key: string; catalog: ProductCatalog };

  constructor(archive: SnapshotArchive) {
    this.archive = archive;
  }

  async load(idGame: number, day: string): Promise<ProductCatalog> {
    const sources: { file: FeedFile; day: string }[] = [];
    for (const kind of [FeedKind.singles, FeedKind.nonSingles]) {
      const file = new FeedFile(kind, idGame);
      const days = await this.archive.days(file);
      const chosen = days.findLast((archived) => archived <= day) ?? days[0];
      if (chosen) sources.push({ file, day: chosen });
    }

    const key = sources.map((source) => `${source.file.key}@${source.day}`).join("|");
    if (this.cached?.key === key) return this.cached.catalog;

    const products: ProductEntry[] = [];
    for (const source of sources) products.push(...(await this.archive.read<ProductListContent>(source.file, source.day)).products);
    const catalog = sources.length === 0 ? ProductCatalog.empty : new ProductCatalog(products);
    this.cached = { key, catalog };
    return catalog;
  }
}
