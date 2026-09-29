// Content of Cardmarket's public files, as published (only the fields this tool reads).

/** One line of the price guide. Prices are in euros; null (or missing) when Cardmarket has no value. */
export interface PriceGuideEntry {
  idProduct: number;
  idCategory: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  "avg-foil"?: number | null;
  "low-foil"?: number | null;
  "trend-foil"?: number | null;
  "avg1-foil"?: number | null;
  "avg7-foil"?: number | null;
  "avg30-foil"?: number | null;
}

export interface PriceGuideContent {
  version: number;
  createdAt: string;
  priceGuides: PriceGuideEntry[];
}

/** One product of a catalogue (single cards or other products). */
export interface ProductEntry {
  idProduct: number;
  name: string;
  idCategory: number;
  categoryName: string;
  idExpansion: number;
  idMetacard: number;
  dateAdded: string;
}

export interface ProductListContent {
  version: number;
  createdAt: string;
  products: ProductEntry[];
}
