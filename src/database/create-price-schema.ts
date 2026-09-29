// First migration: the tables, then the price hypertable and its compression.
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePriceSchema1790668800000 implements MigrationInterface {
  name = "CreatePriceSchema1790668800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    await queryRunner.query(`
      CREATE TABLE product (
        id_product integer PRIMARY KEY,
        game smallint NOT NULL,
        name text NOT NULL,
        category text NOT NULL,
        id_expansion integer NOT NULL,
        id_metacard integer NOT NULL
      )`);
    await queryRunner.query(`
      CREATE TABLE price (
        day date NOT NULL,
        id_product integer NOT NULL,
        game smallint NOT NULL,
        low double precision, trend double precision, avg double precision,
        avg1 double precision, avg7 double precision, avg30 double precision,
        low_foil double precision, trend_foil double precision, avg_foil double precision,
        avg1_foil double precision, avg7_foil double precision, avg30_foil double precision,
        PRIMARY KEY (id_product, day)
      )`);
    await queryRunner.query(`
      CREATE TABLE imported_file (
        feed text NOT NULL,
        day date NOT NULL,
        rows integer NOT NULL,
        imported_at timestamptz NOT NULL,
        PRIMARY KEY (feed, day)
      )`);
    // Hypertable split into 7-day chunks (TimescaleDB's default).
    await queryRunner.query("SELECT create_hypertable('price', by_range('day'))");
    // Compression measured on 60 simulated days of Magic + Star Wars Unlimited (2026-09-29): about 3.3 MB per day.
    // Rows sorted by product then day, so a price that does not move compresses to almost nothing.
    // Grouping by game keeps large compressed batches (grouping by product took several times more space in the same test).
    await queryRunner.query(`
      ALTER TABLE price SET (
        timescaledb.compress,
        timescaledb.compress_orderby = 'id_product, day',
        timescaledb.compress_segmentby = 'game'
      )`);
    // A background job compresses the chunks once they are older than 7 days.
    await queryRunner.query("SELECT add_compression_policy('price', compress_after => INTERVAL '7 days')");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE imported_file");
    await queryRunner.query("DROP TABLE price");
    await queryRunner.query("DROP TABLE product");
  }
}
