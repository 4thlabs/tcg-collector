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

export class CatalogIndex {
  readonly expansions: ExpansionOption[];
  private readonly cards: Map<string, CardEntry>;
  private readonly search: MiniSearch<CardEntry>;

  constructor(products: readonly ProductRecord[], trends: readonly TrendRecord[]) {
    const labels = CatalogIndex.expansionLabels(products);
    const prices = new Map(trends.map((trend) => [trend.product, trend]));
    const cards = products.map((record): CardEntry => {
      const price = prices.get(record.product);
      return {
        product: record.product,
        name: record.name,
        single: CatalogIndex.isSingle(record.category),
        expansionId: record.expansionId,
        expansion: record.expansionId === null ? null : (labels.get(record.expansionId) ?? null),
        version: null,
        added: record.added,
        trend: price?.trend ?? null,
        low: price?.low ?? null,
        trendFoil: price?.trendFoil ?? null,
      };
    });
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
    if (text) {
      matches = this.matches(text, filter);
    } else {
      matches = [...this.cards.values()].filter(filter);
      if (request.sort === "relevance") request = { ...request, sort: "newest" };
    }
    CatalogIndex.sort(matches, request.sort);
    return { total: matches.length, cards: matches.slice(request.offset, request.offset + request.limit) };
  }

  /**
   * Cards whose name matches the text, best first, then most recent. Typos are only tolerated when nothing
   * matches as typed (one edit every five letters), so a correct query never fills up with look-alikes.
   */
  private matches(text: string, filter: (card: CardEntry) => boolean): CardEntry[] {
    let hits = this.search.search(text);
    if (hits.length === 0) hits = this.search.search(text, { fuzzy: 0.2 });
    return hits
      .map((hit) => ({ card: this.cards.get(String(hit.id)), score: hit.score }))
      .filter((hit): hit is { card: CardEntry; score: number } => hit.card !== undefined && filter(hit.card))
      .sort((a, b) => b.score - a.score || CatalogIndex.newestFirst(a.card, b.card))
      .map((hit) => hit.card);
  }

  /** Same name in the same expansion: numbers the versions by idProduct, the order Cardmarket uses for V.1, V.2… */
  static numberVersions(cards: CardEntry[]): void {
    const groups = Map.groupBy(cards, (card) => `${card.expansionId}/${card.name}`);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => Number(a.product) - Number(b.product));
      group.forEach((card, index) => (card.version = index + 1));
    }
  }

  /** Cardmarket's categories end with "Single" for single cards ("Magic Single", "Star Wars Unlimited Single"). */
  private static isSingle(category: string): boolean {
    return category.endsWith("Single");
  }

  private static passes(card: CardEntry, request: SearchRequest): boolean {
    if (request.expansionId !== undefined && card.expansionId !== request.expansionId) return false;
    if (request.kind === "single" && !card.single) return false;
    if (request.kind === "sealed" && card.single) return false;
    if (request.minTrend !== undefined && (card.trend === null || card.trend < request.minTrend)) return false;
    if (request.maxTrend !== undefined && (card.trend === null || card.trend > request.maxTrend)) return false;
    return true;
  }

  /** Relevance keeps MiniSearch's order; cards without a trend price go last when sorting by price. */
  private static sort(cards: CardEntry[], order: SortOrder): void {
    const byTrend = (direction: number) => (a: CardEntry, b: CardEntry) =>
      a.trend === null ? (b.trend === null ? 0 : 1) : b.trend === null ? -1 : direction * (a.trend - b.trend);
    if (order === "trend-desc") cards.sort(byTrend(-1));
    else if (order === "trend-asc") cards.sort(byTrend(1));
    else if (order === "newest") cards.sort(CatalogIndex.newestFirst);
  }

  private static newestFirst(a: CardEntry, b: CardEntry): number {
    return (b.added ?? "").localeCompare(a.added ?? "") || Number(b.product) - Number(a.product);
  }

  /** Label of each expansion, from the names of its sealed products. */
  private static expansionLabels(products: readonly ProductRecord[]): Map<number, string> {
    const sealed = Map.groupBy(
      products.filter((record) => record.expansionId !== null && !CatalogIndex.isSingle(record.category)),
      (record) => record.expansionId as number,
    );
    const labels = new Map<number, string>();
    for (const [id, records] of sealed) {
      const label = ExpansionLabel.fromSealedNames(records.map((record) => record.name));
      if (label) labels.set(id, label);
    }
    return labels;
  }

  /** Expansions with a name, most recent first, for the filter. */
  private static expansionOptions(cards: readonly CardEntry[]): ExpansionOption[] {
    const options = new Map<number, ExpansionOption>();
    for (const card of cards) {
      if (card.expansionId === null || card.expansion === null) continue;
      const option = options.get(card.expansionId) ?? { id: card.expansionId, label: card.expansion, added: null, count: 0 };
      option.count++;
      if (card.added && (!option.added || card.added > option.added)) option.added = card.added;
      options.set(card.expansionId, option);
    }
    return [...options.values()].sort((a, b) => (b.added ?? "").localeCompare(a.added ?? "") || a.label.localeCompare(b.label));
  }
}
