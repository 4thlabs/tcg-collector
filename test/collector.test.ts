import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CardmarketClient, type RemoteVersion } from "../src/cardmarket/cardmarket-client.ts";
import { FeedKind, type FeedFile } from "../src/cardmarket/feed-file.ts";
import { Collector } from "../src/collect/collector.ts";
import { GameSelection } from "../src/collect/game-selection.ts";
import { LoggerFactory } from "../src/logging/logger-factory.ts";
import { FingerprintLedger } from "../src/storage/fingerprint-ledger.ts";
import { SnapshotArchive } from "../src/storage/snapshot-archive.ts";

/** Fake Cardmarket: a single published file whose ETag and content can be changed. */
class FakeClient extends CardmarketClient {
  etag = "a";
  createdAt = "2026-09-28";
  low = 1;
  downloads = 0;

  override async probe(file: FeedFile): Promise<RemoteVersion | null> {
    return file.idGame === 21 ? { etag: this.etag, lastModified: "", size: 10 } : null;
  }

  override async download(): Promise<Buffer> {
    this.downloads++;
    return Buffer.from(JSON.stringify({ createdAt: this.createdAt, priceGuides: [{ idProduct: 1, low: this.low }] }));
  }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "collector-"));
  const client = new FakeClient();
  const run = async (day: string) => {
    const collector = new Collector(client, await FingerprintLedger.open(join(dir, "ledger.json")), new SnapshotArchive(dir), LoggerFactory.silent(), [FeedKind.priceGuide]);
    return collector.collect(GameSelection.parse("1,21"), new Date(`${day}T12:00:00Z`));
  };
  const archives = () => readdir(join(dir, "price_guide", "21"));
  return { client, run, archives };
}

test("first collection: archives the published file, skips the absent game", async () => {
  const { run, archives } = await setup();
  const report = await run("2026-09-28");
  assert.equal(report.count("archived"), 1);
  assert.equal(report.count("absent"), 1);
  assert.deepEqual(await archives(), ["2026-09-28.json.gz"]);
});

test("same ETag: nothing is downloaded", async () => {
  const { client, run } = await setup();
  await run("2026-09-28");
  const report = await run("2026-09-29");
  assert.equal(report.count("unchanged"), 1);
  assert.equal(client.downloads, 1);
});

test("file regenerated with the same content: downloaded but not archived", async () => {
  const { client, run, archives } = await setup();
  await run("2026-09-28");
  client.etag = "b";
  client.createdAt = "2026-09-29";
  const report = await run("2026-09-29");
  assert.equal(report.count("same-content"), 1);
  assert.deepEqual(await archives(), ["2026-09-28.json.gz"]);
});

test("changed price: new archive dated today", async () => {
  const { client, run, archives } = await setup();
  await run("2026-09-28");
  client.etag = "c";
  client.low = 2;
  const report = await run("2026-09-29");
  assert.equal(report.count("archived"), 1);
  assert.deepEqual(await archives(), ["2026-09-28.json.gz", "2026-09-29.json.gz"]);
});
