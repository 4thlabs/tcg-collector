// Les trois fichiers publics que Cardmarket publie pour chaque jeu.

/** Type de fichier : Price Guide, catalogue des cartes à l'unité, catalogue des autres produits. */
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
    if (!kind) throw new Error(`Type de fichier inconnu : ${name} (attendus : ${FeedKind.all.map((k) => k.name).join(", ")})`);
    return kind;
  }

  /** Chemin relatif sur le serveur Cardmarket, ex. « priceGuide/price_guide_21.json ». */
  remotePath(idGame: number): string {
    return `${this.folder}/${this.name}_${idGame}.json`;
  }
}

/** Un fichier précis : un type de fichier pour un jeu donné. */
export class FeedFile {
  readonly kind: FeedKind;
  readonly idGame: number;

  constructor(kind: FeedKind, idGame: number) {
    this.kind = kind;
    this.idGame = idGame;
  }

  /** Clé stable, utilisée dans le registre des empreintes et dans les logs. */
  get key(): string {
    return `${this.kind.name}_${this.idGame}`;
  }

  get remotePath(): string {
    return this.kind.remotePath(this.idGame);
  }
}
