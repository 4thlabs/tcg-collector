// Tables of the price database, described with TypeORM entity schemas. No decorators: Node runs this
// TypeScript directly, and its type stripping does not support them (no compilation step in this project).
import { EntitySchema } from "typeorm";

/** A Cardmarket product, from the latest catalogue imported. */
export interface Product {
  idProduct: number;
  game: number;
  name: string;
  category: string;
  idExpansion: number;
  idMetacard: number;
}

/** Price guide values of one product on one day, in euros; null when Cardmarket has no value. */
export interface Price {
  /** Archive day, YYYY-MM-DD. */
  day: string;
  idProduct: number;
  game: number;
  low: number | null;
  trend: number | null;
  avg: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  lowFoil: number | null;
  trendFoil: number | null;
  avgFoil: number | null;
  avg1Foil: number | null;
  avg7Foil: number | null;
  avg30Foil: number | null;
}

/** A price guide archive already imported: the importer skips it next time. */
export interface ImportedFile {
  /** File key, e.g. "price_guide_21". */
  feed: string;
  /** Archive day, YYYY-MM-DD. */
  day: string;
  rows: number;
  importedAt: Date;
}

const priceColumn = (name: string) => ({ name, type: "double precision" as const, nullable: true });

export const ProductEntity = new EntitySchema<Product>({
  name: "Product",
  tableName: "product",
  columns: {
    idProduct: { name: "id_product", type: "integer", primary: true },
    game: { type: "smallint" },
    name: { type: "text" },
    category: { type: "text" },
    idExpansion: { name: "id_expansion", type: "integer" },
    idMetacard: { name: "id_metacard", type: "integer" },
  },
});

/** TimescaleDB hypertable on "day" (see the migration): one row per product and per day. */
export const PriceEntity = new EntitySchema<Price>({
  name: "Price",
  tableName: "price",
  columns: {
    day: { type: "date", primary: true },
    idProduct: { name: "id_product", type: "integer", primary: true },
    game: { type: "smallint" },
    low: priceColumn("low"),
    trend: priceColumn("trend"),
    avg: priceColumn("avg"),
    avg1: priceColumn("avg1"),
    avg7: priceColumn("avg7"),
    avg30: priceColumn("avg30"),
    lowFoil: priceColumn("low_foil"),
    trendFoil: priceColumn("trend_foil"),
    avgFoil: priceColumn("avg_foil"),
    avg1Foil: priceColumn("avg1_foil"),
    avg7Foil: priceColumn("avg7_foil"),
    avg30Foil: priceColumn("avg30_foil"),
  },
});

export const ImportedFileEntity = new EntitySchema<ImportedFile>({
  name: "ImportedFile",
  tableName: "imported_file",
  columns: {
    feed: { type: "text", primary: true },
    day: { type: "date", primary: true },
    rows: { type: "integer" },
    importedAt: { name: "imported_at", type: "timestamptz" },
  },
});
