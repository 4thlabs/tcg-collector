import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ky from "ky";
import { CardImages } from "../src/web/card-images.ts";
import type { CardEntry } from "../src/web/catalog-index.ts";
import { type ImageSource, ScryfallImages, SwuImages } from "../src/web/image-sources.ts";
import { PoliteHttp } from "../src/web/polite-http.ts";

const card = (product: string, name = "Sol Ring", expansionId: number | null = 6572, trendFoil: number | null = null): CardEntry => ({
  product, name, single: true, expansionId, expansion: null, version: null, added: null, trend: 1, low: 1, trendFoil,
});

/** One printing in the answer of the Star Wars Unlimited database. */
const swuCard = (title: string, subtitle: string | null, variant: string) => ({
  attributes: {
    title, subtitle,
    variantTypes: { data: [{ attributes: { name: variant } }] },
    artFront: { data: { attributes: { url: `https://cdn.example/${variant}.png`, formats: { xxsmall: { url: `https://cdn.example/small_${variant}.png` } } } } },
  },
});

/** Fake web: Scryfall has 910771, the SWU database has Luke in SOR, the CDN serves PNGs; records the requests. */
function fakeWeb() {
  const requests: string[] = [];
  const http = ky.create({
    retry: 0,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(decodeURIComponent(url.host + url.pathname + url.search));
      if (url.host === "api.scryfall.com")
        return url.pathname.endsWith("/910771") ? new Response(Buffer.from("jpeg bytes"), { headers: { "content-type": "image/jpeg" } }) : new Response("{}", { status: 404 });
      if (url.host === "cdn.example") return new Response(Buffer.from(`png ${url.pathname}`), { headers: { "content-type": "image/png" } });
      const set = url.searchParams.get("filters[expansion][code][$eq]");
      const luke = url.searchParams.get("filters[title][$startsWithi]") === "Luke Skywalker" && (set === "SOR" || set === null);
      const data = luke
        ? [
            swuCard("Luke Skywalker", "Faithful Friend", "Prerelease Promo"),
            swuCard("Luke Skywalker", "Faithful Friend", "Standard"),
            swuCard("Luke Skywalker", "Faithful Friend", "Hyperspace"),
            swuCard("Luke Skywalker", "Faithful Friend", "Showcase"),
            swuCard("Luke Skywalker", "Jedi Knight", "Standard"),
          ]
        : [];
      return Response.json({ data });
    },
  });
  return { http: new PoliteHttp(http, 0), requests };
}

async function images(sources: [string, (http: PoliteHttp) => ImageSource][]) {
  const folder = await mkdtemp(join(tmpdir(), "images-"));
  const web = fakeWeb();
  const make = () => new CardImages(folder, web.http, new Map(sources.map(([game, source]) => [game, source(web.http)])));
  return { folder, make, requests: web.requests };
}

test("fetches an image once, then serves it from disk", async () => {
  const { folder, make, requests } = await images([["1", () => new ScryfallImages()]]);
  assert.deepEqual(await make().get("1", card("910771"), "small"), { bytes: Buffer.from("jpeg bytes"), type: "image/jpeg" });
  assert.equal((await make().get("1", card("910771"), "small"))?.bytes.toString(), "jpeg bytes");
  assert.deepEqual(requests, ["api.scryfall.com/cards/cardmarket/910771?format=image&version=small"]);
  assert.deepEqual(await readdir(join(folder, "1", "small")), ["910771.jpg"]);
});

test("remembers a card without image", async () => {
  const { make, requests } = await images([["1", () => new ScryfallImages()]]);
  const cardImages = make();
  assert.equal(await cardImages.get("1", card("42"), "normal"), null);
  assert.equal(await cardImages.get("1", card("42"), "normal"), null);
  assert.equal(requests.length, 1);
});

test("has no image for a game without source", async () => {
  const { make, requests } = await images([["1", () => new ScryfallImages()]]);
  assert.equal(await make().get("3", card("1"), "small"), null);
  assert.equal(requests.length, 0);
});

test("finds a Star Wars Unlimited card by expansion and name, one lookup for both sizes", async () => {
  const { folder, make, requests } = await images([["21", (http) => new SwuImages(http)]]);
  const cardImages = make();
  const luke = card("759959", "Luke Skywalker, Faithful Friend", 5618);
  assert.deepEqual(await cardImages.get("21", luke, "small"), { bytes: Buffer.from("png /small_Standard.png"), type: "image/png" });
  assert.equal((await cardImages.get("21", luke, "normal"))?.bytes.toString(), "png /Standard.png");
  assert.deepEqual(requests, [
    "admin.starwarsunlimited.com/api/cards?locale=en&pagination[pageSize]=100&filters[title][$startsWithi]=Luke+Skywalker&filters[expansion][code][$eq]=SOR",
    "cdn.example/small_Standard.png",
    "cdn.example/Standard.png",
  ]);
  assert.deepEqual(await readdir(join(folder, "21", "small")), ["759959.png"]);
});

test("tells Hyperspace from Showcase by the foil price", async () => {
  const { make } = await images([["21", (http) => new SwuImages(http)]]);
  const cardImages = make();
  const hyperspace = await cardImages.get("21", card("1", "Luke Skywalker, Faithful Friend", 5638), "normal");
  const showcase = await cardImages.get("21", card("2", "Luke Skywalker, Faithful Friend", 5638, 120), "normal");
  assert.equal(hyperspace?.bytes.toString(), "png /Hyperspace.png");
  assert.equal(showcase?.bytes.toString(), "png /Showcase.png");
});

test("shows any printing of a promo, and nothing for an unknown name", async () => {
  const { make, requests } = await images([["21", (http) => new SwuImages(http)]]);
  const cardImages = make();
  const promo = await cardImages.get("21", card("3", "Luke Skywalker, Faithful Friend", 6101), "small");
  assert.equal(promo?.bytes.toString(), "png /small_Standard.png");
  assert.equal(requests[0], "admin.starwarsunlimited.com/api/cards?locale=en&pagination[pageSize]=100&filters[title][$startsWithi]=Luke+Skywalker");
  assert.equal(await cardImages.get("21", card("4", "Luke Skywalker, Hero of Yavin", 5618), "small"), null);
});
