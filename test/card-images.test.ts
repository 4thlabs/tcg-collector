import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ky from "ky";
import { CardImages } from "../src/web/card-images.ts";

/** Fake Scryfall: an image for 910771, 404 for anything else; counts the requests. */
function fakeScryfall() {
  const requests: string[] = [];
  const http = ky.create({
    retry: 0,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.pathname + url.search);
      return url.pathname.endsWith("/910771") ? new Response(Buffer.from("jpeg bytes"), { headers: { "content-type": "image/jpeg" } }) : new Response("{}", { status: 404 });
    },
  });
  return { http, requests };
}

test("fetches an image once, then serves it from disk", async () => {
  const folder = await mkdtemp(join(tmpdir(), "images-"));
  const { http, requests } = fakeScryfall();
  const images = new CardImages(folder, http);
  assert.equal((await images.get("1", "910771", "small"))?.toString(), "jpeg bytes");
  assert.equal((await new CardImages(folder, http).get("1", "910771", "small"))?.toString(), "jpeg bytes");
  assert.deepEqual(requests, ["/cards/cardmarket/910771?format=image&version=small"]);
  assert.deepEqual(await readdir(join(folder, "1", "small")), ["910771.jpg"]);
});

test("remembers a card without image", async () => {
  const folder = await mkdtemp(join(tmpdir(), "images-"));
  const { http, requests } = fakeScryfall();
  const images = new CardImages(folder, http);
  assert.equal(await images.get("1", "42", "normal"), null);
  assert.equal(await images.get("1", "42", "normal"), null);
  assert.equal(requests.length, 1);
});

test("has no image source for other games", async () => {
  const { http, requests } = fakeScryfall();
  assert.equal(await new CardImages(await mkdtemp(join(tmpdir(), "images-")), http).get("21", "903189", "small"), null);
  assert.equal(requests.length, 0);
});
