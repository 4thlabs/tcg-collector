import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { CardmarketClient } from "../src/cardmarket/cardmarket-client.ts";
import { FeedFile, FeedKind } from "../src/cardmarket/feed-file.ts";

/** Fake S3 bucket: game 1 answers a whole file, game 2 sends the headers and part of the body, then stalls. */
const server: Server = createServer((request, response) => {
  if (request.url === "/priceGuide/price_guide_1.json") {
    response.end('{"version":1}');

    return;
  }

  if (request.url === "/priceGuide/price_guide_2.json") {
    response.writeHead(200, { "content-length": "1000" });
    response.write('{"version":');

    return;
  }

  response.writeHead(404);
  response.end();
});

let client: CardmarketClient;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  // One attempt and a short timeout, so the stalled download fails fast.
  client = new CardmarketClient(`http://127.0.0.1:${port}`, 1, 0, 300);
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test("downloads a whole file", async () => {
  const body = await client.download(new FeedFile(FeedKind.priceGuide, 1));

  assert.equal(body.toString("utf8"), '{"version":1}');
});

// The test's own timeout turns a hanging download into a failure instead of a stuck test run.
test("gives up on a download whose body stalls", { timeout: 5_000 }, async () => {
  const stalled = client.download(new FeedFile(FeedKind.priceGuide, 2));

  await assert.rejects(stalled, { name: "TimeoutError" });
});
