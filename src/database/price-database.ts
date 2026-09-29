// Access to the TimescaleDB price database through TypeORM: schema migrations, import bookkeeping, upserts.
import { DataSource, type EntityManager, type EntityTarget } from "typeorm";
import type { Logger } from "../logging/logger-factory.ts";
import { CreatePriceSchema1790668800000 } from "./create-price-schema.ts";
import { ImportedFileEntity, PriceEntity, ProductEntity, type Price, type Product } from "./entities.ts";

export class PriceDatabase {
  /**
   * Rows per INSERT: PostgreSQL accepts at most 65,535 parameters per query, and a price row has 15 columns.
   */
  static readonly batchSize = 4_000;

  private readonly dataSource: DataSource;

  private constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
  }

  /** Connects and brings the schema up to date (migrations are recorded in the "migrations" table). */
  static async open(url: string, logger: Logger): Promise<PriceDatabase> {
    const dataSource = new DataSource({
      type: "postgres",
      url,
      entities: [ProductEntity, PriceEntity, ImportedFileEntity],
      migrations: [CreatePriceSchema1790668800000],
      logging: false,
    });
    await dataSource.initialize();
    const applied = await dataSource.runMigrations({ transaction: "each" });
    for (const migration of applied) logger.info(`database migration applied: ${migration.name}`);
    return new PriceDatabase(dataSource);
  }

  /** Days already imported for a file key, e.g. "price_guide_21". */
  async importedDays(feed: string): Promise<Set<string>> {
    const rows = await this.dataSource.getRepository(ImportedFileEntity).find({ where: { feed }, select: { day: true } });
    return new Set(rows.map((row) => row.day));
  }

  /**
   * Saves one price guide day in a single transaction: the products (when given), the prices,
   * and the record that this day was imported. Existing rows are updated, so a replay creates no duplicates.
   */
  async saveDay(feed: string, day: string, prices: readonly Price[], products?: readonly Product[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (products) await PriceDatabase.upsert(manager, ProductEntity, products, ["idProduct"]);
      await PriceDatabase.upsert(manager, PriceEntity, prices, ["idProduct", "day"]);
      await manager.getRepository(ImportedFileEntity).upsert({ feed, day, rows: prices.length, importedAt: new Date() }, ["feed", "day"]);
    });
  }

  async close(): Promise<void> {
    await this.dataSource.destroy();
  }

  private static async upsert<T extends object>(manager: EntityManager, entity: EntityTarget<T>, rows: readonly T[], conflictPaths: string[]): Promise<void> {
    const repository = manager.getRepository(entity);
    for (let start = 0; start < rows.length; start += PriceDatabase.batchSize) {
      await repository.upsert(rows.slice(start, start + PriceDatabase.batchSize) as never[], { conflictPaths });
    }
  }
}
