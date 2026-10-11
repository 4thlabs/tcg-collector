// In-memory search over one game's catalogue: fuzzy name search (MiniSearch), filters and sorting.
import MiniSearch from "minisearch";
import type { ProductRecord, TrendRecord } from "./card-catalog.ts";
import { ExpansionLabel } from "./expansion-label.ts";

/** One product as the list shows it. */
export interface CardEntry {
  product: string;
  name: string;
  single: boolean;
  expansionId: number | null;
  /** Expansion name guessed from its sealed products; null when it has none. */
  expansion: string | null;
  /** 1, 2… when the expansion has several products with this name (Cardmarket's V.1, V.2…), else null. */
  version: number | null;
  added: string | null;
  trend: number | null;
  low: number | null;
  trendFoil: number | null;
}

export interface ExpansionOption {
  id: number;
  label: string;
  /** Most recent date a product of the expansion was added, YYYY-MM-DD. */
  added: string | null;
  count: number;
}

export type ProductKind = "all" | "single" | "sealed";
export type SortOrder = "relevance" | "trend-desc" | "trend-asc" | "newest";

export interface SearchRequest {
  text: string;
  expansionId?: number;
  kind: ProductKind;
  minTrend?: number;
  maxTrend?: number;
  sort: SortOrder;
  offset: number;
  limit: number;
}

export interface SearchResult {
  total: number;
  cards: CardEntry[];
}

/** A search hit kept after the filters, with its MiniSearch score. */
interface ScoredCard {
  card: CardEntry;
  score: number;
}

export class CatalogIndex {
  readonly expansions: ExpansionOption[];
  private readonly cards: Map<string, CardEntry>;
  private readonly search: MiniSearch<CardEntry>;

  constructor(products: readonly ProductRecord[], trends: readonly TrendRecord[]) {
    const labels = CatalogIndex.expansionLabels(products);
    const trendsByProduct = new Map(trends.map((trend) => [trend.product, trend]));
    const cards: CardEntry[] = [];

    for (const record of products) {
      const trend = trendsByProduct.get(record.product);

      cards.push(CatalogIndex.toCard(record, labels, trend));
    }

    CatalogIndex.numberVersions(cards);

    this.cards = new Map(cards.map((card) => [card.product, card]));
    this.expansions = CatalogIndex.expansionOptions(cards);
    // Every typed word must start a word of the name, in any order.
    this.search = new MiniSearch<CardEntry>({
      idField: "product",
      fields: ["name"],
      storeFields: [],
      searchOptions: { prefix: true, combineWith: "AND" },
    });
    this.search.addAll(cards);
  }

  /** One product by idProduct, or null. */
  card(product: string): CardEntry | null {
    return this.cards.get(product) ?? null;
  }

  get size(): number {
    return this.cards.size;
  }

  find(request: SearchRequest): SearchResult {
    const text = request.text.trim();
    const filter = (card: CardEntry) => CatalogIndex.passes(card, request);

    let matches: CardEntry[];
    let sort = request.sort;

    if (text) {
      matches = this.matches(text, filter);
    } else {
      matches = [...this.cards.values()].filter(filter);
      // Without text there is no relevance: the newest products come first.
      if (sort === "relevance") {
        sort = "newest";
      }
    }

    CatalogIndex.sort(matches, sort);

    const page = matches.slice(request.offset, request.offset + request.limit);

    return { total: matches.length, cards: page };
  }

  /**
   * Cards whose name matches the text, best first, then most recent. Typos are only tolerated when nothing
   * matches as typed (one edit every five letters), so a correct query never fills up with look-alikes.
   */
  private matches(text: string, filter: (card: CardEntry) => boolean): CardEntry[] {
    let hits = this.search.search(text);

    if (hits.length === 0) {
      hits = this.search.search(text, { fuzzy: 0.2 });
    }

    const found: ScoredCard[] = [];

    for (const hit of hits) {
      const card = this.cards.get(String(hit.id));

      if (!card || !filter(card)) {
        continue;
      }

      found.push({ card, score: hit.score });
    }

    found.sort((a, b) => b.score - a.score || CatalogIndex.newestFirst(a.card, b.card));

    return found.map((hit) => hit.card);
  }

  /** A product as the list shows it; its version is numbered later, once all the cards are known. */
  private static toCard(record: ProductRecord, labels: Map<number, string>, trend: TrendRecord | undefined): CardEntry {
    let expansion: string | null = null;

    if (record.expansionId !== null) {
      expansion = labels.get(record.expansionId) ?? null;
    }

    return {
      product: record.product,
      name: record.name,
      single: CatalogIndex.isSingle(record.category),
      expansionId: record.expansionId,
      expansion,
      version: null,
      added: record.added,
      trend: trend?.trend ?? null,
      low: trend?.low ?? null,
      trendFoil: trend?.trendFoil ?? null,
    };
  }

  /** Same name in the same expansion: numbers the versions by idProduct, the order Cardmarket uses for V.1, V.2… */
  private static numberVersions(cards: CardEntry[]): void {
    const groups = Map.groupBy(cards, (card) => `${card.expansionId}/${card.name}`);

    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }

      group.sort((a, b) => Number(a.product) - Number(b.product));
      for (const [index, card] of group.entries()) {
        card.version = index + 1;
      }
    }
  }

  /** Cardmarket's categories end with "Single" for single cards ("Magic Single", "Star Wars Unlimited Single"). */
  private static isSingle(category: string): boolean {
    return category.endsWith("Single");
  }

  private static passes(card: CardEntry, request: SearchRequest): boolean {
    if (request.expansionId !== undefined && card.expansionId !== request.expansionId) {
      return false;
    }

    if (request.kind === "single" && !card.single) {
      return false;
    }

    if (request.kind === "sealed" && card.single) {
      return false;
    }

    // A price filter leaves out the cards without a trend price.
    if (request.minTrend !== undefined) {
      if (card.trend === null || card.trend < request.minTrend) {
        return false;
      }
    }

    if (request.maxTrend !== undefined) {
      if (card.trend === null || card.trend > request.maxTrend) {
        return false;
      }
    }

    return true;
  }

  /** Relevance keeps MiniSearch's order. */
  private static sort(cards: CardEntry[], order: SortOrder): void {
    if (order === "trend-desc") {
      cards.sort((a, b) => CatalogIndex.byTrend(a, b, -1));
    } else if (order === "trend-asc") {
      cards.sort((a, b) => CatalogIndex.byTrend(a, b, 1));
    } else if (order === "newest") {
      cards.sort(CatalogIndex.newestFirst);
    }
  }

  /** Compares trend prices, ascending (direction 1) or descending (-1); cards without a trend go last either way. */
  private static byTrend(a: CardEntry, b: CardEntry, direction: 1 | -1): number {
    if (a.trend === null && b.trend === null) {
      return 0;
    }

    if (a.trend === null) {
      return 1;
    }

    if (b.trend === null) {
      return -1;
    }

    return direction * (a.trend - b.trend);
  }

  /** Most recently added first; between products added the same day, the highest idProduct first. */
  private static newestFirst(a: CardEntry, b: CardEntry): number {
    const byDate = (b.added ?? "").localeCompare(a.added ?? "");

    if (byDate !== 0) {
      return byDate;
    }

    return Number(b.product) - Number(a.product);
  }

  /** Label of each expansion, from the names of its sealed products. */
  private static expansionLabels(products: readonly ProductRecord[]): Map<number, string> {
    const sealedNames = new Map<number, string[]>();

    for (const record of products) {
      if (record.expansionId === null || CatalogIndex.isSingle(record.category)) {
        continue;
      }

      const names = sealedNames.get(record.expansionId) ?? [];

      names.push(record.name);
      sealedNames.set(record.expansionId, names);
    }

    const labels = new Map<number, string>();

    for (const [id, names] of sealedNames) {
      const label = ExpansionLabel.fromSealedNames(names);

      if (!label) {
        continue;
      }

      labels.set(id, label);
    }

    return labels;
  }

  /** Expansions with a name, most recent first, for the filter. */
  private static expansionOptions(cards: readonly CardEntry[]): ExpansionOption[] {
    const options = new Map<number, ExpansionOption>();

    for (const card of cards) {
      if (card.expansionId === null || card.expansion === null) {
        continue;
      }

      let option = options.get(card.expansionId);

      if (!option) {
        option = { id: card.expansionId, label: card.expansion, added: null, count: 0 };
        options.set(card.expansionId, option);
      }

      option.count++;
      if (!card.added) {
        continue;
      }

      if (option.added === null || card.added > option.added) {
        option.added = card.added;
      }
    }

    return [...options.values()].sort(CatalogIndex.newestExpansionFirst);
  }

  /** Most recently added first; then by label. */
  private static newestExpansionFirst(a: ExpansionOption, b: ExpansionOption): number {
    const byDate = (b.added ?? "").localeCompare(a.added ?? "");

    if (byDate !== 0) {
      return byDate;
    }

    return a.label.localeCompare(b.label);
  }
}
