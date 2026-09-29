// The three public files Cardmarket publishes for each game.

/** File type: price guide, single-card catalogue, catalogue of other products. */
export class FeedKind {
  static readonly priceGuide = new FeedKind("price_guide", "priceGuide");
  static readonly singles = new FeedKind("products_singles", "productList");
  static readonly nonSingles = new FeedKind("products_nonsingles", "productList");
  static readonly all: readonly FeedKind[] = [FeedKind.priceGuide, FeedKind.singles, FeedKind.nonSingles];

  readonly name: string;
  private readonly folder: string;

  private constructor(name: string, folder: string) {
    this.name = name;
    this.folder = folder;
  }

  static byName(name: string): FeedKind {
    const kind = FeedKind.all.find((k) => k.name === name);
    if (!kind) throw new Error(`Unknown file type: ${name} (expected: ${FeedKind.all.map((k) => k.name).join(", ")})`);
    return kind;
  }

  /** Path relative to the Cardmarket server, e.g. "priceGuide/price_guide_21.json". */
  remotePath(idGame: number): string {
    return `${this.folder}/${this.name}_${idGame}.json`;
  }
}

/** One specific file: a file type for a given game. */
export class FeedFile {
  readonly kind: FeedKind;
  readonly idGame: number;

  constructor(kind: FeedKind, idGame: number) {
    this.kind = kind;
    this.idGame = idGame;
  }

  /** Stable key, used in the fingerprint ledger and in logs. */
  get key(): string {
    return `${this.kind.name}_${this.idGame}`;
  }

  get remotePath(): string {
    return this.kind.remotePath(this.idGame);
  }
}
