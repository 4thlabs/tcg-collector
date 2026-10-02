// Card page: searches a card through the tcg-collector API and shows its latest and daily Cardmarket prices.
// Plain browser JavaScript, no build step; Chart.js is served by the same server (vendor/chart.js).
"use strict";

const GAMES = {
  "1": { name: "Magic", cardmarket: "Magic" },
  "21": { name: "Star Wars Unlimited", cardmarket: "StarWarsUnlimited" },
};

/** Calls the JSON API of the server; errors carry the server's message. */
class Api {
  async get(path, params) {
    const response = await fetch(`${path}?${new URLSearchParams(params)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }

  async search(game, q) {
    return (await this.get("api/search", { game, q })).cards;
  }

  async latestPrices(game, product) {
    return (await this.get("api/prices", { game, product })).prices;
  }

  async dailyPrices(game, product, days) {
    return (await this.get("api/daily", { game, product, days })).days;
  }
}

/** Per-browser preferences (game, search, period, card); the page works without them. */
class Preferences {
  read(key, fallback = null) {
    try {
      const value = localStorage.getItem(`cards.${key}`);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  write(key, value) {
    try {
      localStorage.setItem(`cards.${key}`, JSON.stringify(value));
    } catch {
      // Storage unavailable (private window): nothing to keep.
    }
  }
}

/** Display helpers shared by the panels. */
class Format {
  static euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

  static price(value) {
    return value == null ? "—" : Format.euro.format(value);
  }

  static expansion(card) {
    return card.expansion ?? (card.expansionId == null ? "Unknown expansion" : `Expansion ${card.expansionId}`);
  }

  static version(card) {
    return card.version == null ? "" : `V.${card.version}`;
  }

  /** Card image: Scryfall knows Magic cards by their Cardmarket idProduct; nothing for other games yet. */
  static imageUrl(game, card) {
    return game === "1" ? `https://api.scryfall.com/cards/cardmarket/${encodeURIComponent(card.product)}?format=image&version=normal` : null;
  }

  static cardmarketUrl(game, card) {
    return `https://www.cardmarket.com/en/${GAMES[game].cardmarket}/Products?idProduct=${encodeURIComponent(card.product)}`;
  }
}

/** Left rail: search box results, one line per product. */
class SearchPanel {
  static minLength = 3;

  constructor(api, onSelect) {
    this.api = api;
    this.onSelect = onSelect;
    this.list = document.getElementById("results");
    this.note = document.getElementById("rail-note");
    this.count = document.getElementById("count");
    this.template = document.getElementById("result-template");
    this.sequence = 0;
    this.cards = [];
    this.selected = null;
  }

  /** Runs a search; answers to older searches are dropped. */
  async search(game, text) {
    const sequence = ++this.sequence;
    if (text.length < SearchPanel.minLength) {
      this.show([], "Type at least 3 letters of a card name.");
      return;
    }
    this.showNote("Searching…");
    try {
      const cards = await this.api.search(game, text);
      if (sequence !== this.sequence) return;
      this.show(cards, `No ${GAMES[game].name} card contains “${text}”.`);
    } catch (error) {
      if (sequence === this.sequence) this.show([], `Search failed: ${error.message}.`, true);
    }
  }

  find(product) {
    return this.cards.find((card) => card.product === product) ?? null;
  }

  select(product) {
    this.selected = product;
    for (const item of this.list.children) item.setAttribute("aria-selected", String(item.dataset.product === product));
  }

  show(cards, emptyText, isError = false) {
    this.cards = cards;
    this.count.textContent = cards.length ? String(cards.length) : "";
    this.list.replaceChildren(...cards.map((card) => this.item(card)));
    this.showNote(cards.length ? null : emptyText, isError);
  }

  showNote(text, isError = false) {
    this.note.hidden = !text;
    this.note.textContent = text ?? "";
    this.note.classList.toggle("err", isError);
  }

  item(card) {
    const item = this.template.content.firstElementChild.cloneNode(true);
    item.dataset.product = card.product;
    item.setAttribute("aria-selected", String(card.product === this.selected));
    item.querySelector(".name").textContent = card.name;
    if (card.version != null) {
      const version = document.createElement("span");
      version.className = "version";
      version.textContent = Format.version(card);
      item.querySelector(".name").append(version);
    }
    item.querySelector(".id").textContent = `#${card.product}`;
    item.querySelector(".expansion").textContent = Format.expansion(card);
    item.querySelector(".added").textContent = card.added ? `added ${card.added}` : "";
    item.addEventListener("click", () => this.onSelect(card));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.onSelect(card);
      }
    });
    return item;
  }
}

/** Line chart of the daily prices, redrawn with the theme's colors. */
class PriceChart {
  static series = [
    { field: "low", label: "Low", color: "--accent", dashed: false },
    { field: "trend", label: "Trend", color: "--fg", dashed: false },
    { field: "avg30", label: "30-day avg", color: "--muted", dashed: true },
    { field: "low_foil", label: "Low foil", color: "--foil", dashed: true },
    { field: "trend_foil", label: "Trend foil", color: "--foil", dashed: false },
  ];

  constructor(canvas, note) {
    this.canvas = canvas;
    this.note = note;
    this.chart = null;
    this.days = [];
  }

  draw(days) {
    this.days = days;
    this.chart?.destroy();
    this.chart = null;
    this.note.replaceChildren();
    if (!days.length) return this.message("No price over this period.");
    if (!window.Chart) return this.message("The chart library could not load.", true);
    const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const muted = color("--muted");
    const grid = color("--line");
    const datasets = PriceChart.series
      .filter(({ field }) => days.some((day) => day[field] != null))
      .map(({ field, label, color: token, dashed }) => ({
        label,
        data: days.map((day) => day[field]),
        borderColor: color(token),
        backgroundColor: color(token),
        borderWidth: dashed ? 1.5 : 2,
        borderDash: dashed ? [5, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 3,
        stepped: true,
      }));
    const longPeriod = days.length > 370;
    this.chart = new window.Chart(this.canvas, {
      type: "line",
      data: { labels: days.map((day) => day.day), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { color: muted, boxWidth: 14 } },
          tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${Format.price(item.parsed.y)}` } },
        },
        scales: {
          x: {
            grid: { color: grid },
            ticks: {
              color: muted,
              maxRotation: 0,
              maxTicksLimit: this.canvas.clientWidth < 500 ? 4 : 8,
              // dd/mm, with the year when the period spans more than a year.
              callback(value) {
                const day = this.getLabelForValue(value);
                return `${day.slice(8, 10)}/${day.slice(5, 7)}${longPeriod ? `/${day.slice(2, 4)}` : ""}`;
              },
            },
          },
          y: { grid: { color: grid }, ticks: { color: muted, callback: (value) => Format.price(value) } },
        },
      },
    });
  }

  redraw() {
    if (this.chart) this.draw(this.days);
  }

  message(text, isError = false) {
    const p = document.createElement("p");
    p.className = isError ? "note err" : "note";
    p.textContent = text;
    this.note.replaceChildren(p);
  }
}

/** Right side: the selected card's image, latest prices and daily chart. */
class CardSheet {
  static fields = [
    { field: "low", label: "Low", foil: false },
    { field: "trend", label: "Trend", foil: false },
    { field: "avg30", label: "30-day avg", foil: false },
    { field: "low_foil", label: "Low foil", foil: true },
    { field: "trend_foil", label: "Trend foil", foil: true },
    { field: "avg30_foil", label: "30-day avg foil", foil: true },
  ];

  constructor(api, preferences) {
    this.api = api;
    this.preferences = preferences;
    this.root = document.getElementById("sheet");
    this.template = document.getElementById("sheet-template");
    this.card = null;
    this.game = null;
    this.days = preferences.read("days", 90);
    this.chart = null;
  }

  async show(game, card) {
    this.game = game;
    this.card = card;
    this.render();
    await Promise.all([this.loadLatest(), this.loadDaily()]);
  }

  render() {
    const { game, card } = this;
    const sheet = this.template.content.firstElementChild.cloneNode(true);
    const text = (selector, value) => (sheet.querySelector(selector).textContent = value);
    text(".card-name", card.name);
    text(".card-game", GAMES[game].name);
    text(".card-id", card.product);
    text(".card-expansion", [Format.expansion(card), Format.version(card)].filter(Boolean).join(" · "));
    text(".card-added", card.added ? `added ${card.added}` : "");
    sheet.querySelector(".card-link").href = Format.cardmarketUrl(game, card);

    const imageUrl = Format.imageUrl(game, card);
    const art = sheet.querySelector(".art");
    if (imageUrl) {
      const image = art.querySelector("img");
      image.alt = card.name;
      image.addEventListener("error", () => (art.hidden = true));
      image.src = imageUrl;
      art.hidden = false;
    }

    const range = sheet.querySelector(".range");
    for (const button of range.children) button.setAttribute("aria-pressed", String(Number(button.dataset.days) === this.days));
    range.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-days]");
      if (!button) return;
      this.days = Number(button.dataset.days);
      this.preferences.write("days", this.days);
      for (const other of range.children) other.setAttribute("aria-pressed", String(other === button));
      this.loadDaily();
    });

    this.chart = new PriceChart(sheet.querySelector("canvas"), sheet.querySelector(".chart-note"));
    this.root.replaceChildren(sheet);
  }

  async loadLatest() {
    const card = this.card;
    const box = this.root.querySelector(".prices");
    try {
      const prices = await this.api.latestPrices(this.game, card.product);
      if (card !== this.card) return;
      if (!prices) {
        box.innerHTML = '<p class="note">No archived price for this card.</p>';
        return;
      }
      box.replaceChildren(...CardSheet.fields.filter(({ field, foil }) => !foil || prices[field] != null).map((entry) => this.tile(entry, prices)));
      this.root.querySelector(".asof").textContent = `Latest archived price guide: ${prices.day}`;
    } catch (error) {
      if (card !== this.card) return;
      const p = document.createElement("p");
      p.className = "note err";
      p.textContent = `Prices failed: ${error.message}.`;
      box.replaceChildren(p);
    }
  }

  async loadDaily() {
    const card = this.card;
    const days = this.days;
    try {
      const rows = await this.api.dailyPrices(this.game, card.product, days);
      if (card === this.card && days === this.days) this.chart.draw(rows);
    } catch (error) {
      if (card === this.card) this.chart.message(`Daily prices failed: ${error.message}.`, true);
    }
  }

  tile({ field, label, foil }, prices) {
    const tile = document.createElement("div");
    tile.className = `price${foil ? " foil" : ""}${prices[field] == null ? " empty" : ""}`;
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = Format.price(prices[field]);
    tile.append(name, value);
    return tile;
  }
}

/** Wires the controls, the rail and the sheet; restores the last game, search and card. */
class CardPage {
  constructor() {
    this.api = new Api();
    this.preferences = new Preferences();
    this.game = this.preferences.read("game", "1");
    if (!GAMES[this.game]) this.game = "1";
    this.search = new SearchPanel(this.api, (card) => this.select(card));
    this.sheet = new CardSheet(this.api, this.preferences);
    this.query = document.getElementById("query");
    this.gameButtons = document.getElementById("game");
    this.timer = null;
  }

  async start() {
    this.showGame();
    this.query.value = this.preferences.read("query", "");
    this.query.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.runSearch(), 300);
    });
    this.gameButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-game]");
      if (!button || button.dataset.game === this.game) return;
      this.game = button.dataset.game;
      this.preferences.write("game", this.game);
      this.showGame();
      this.runSearch();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.sheet.chart?.redraw());

    await this.runSearch();
    const saved = this.preferences.read("card");
    if (saved?.game === this.game && saved.card) this.select(this.search.find(saved.card.product) ?? saved.card);
  }

  runSearch() {
    const text = this.query.value.trim();
    this.preferences.write("query", text);
    return this.search.search(this.game, text);
  }

  select(card) {
    this.preferences.write("card", { game: this.game, card });
    this.search.select(card.product);
    this.sheet.show(this.game, card);
  }

  showGame() {
    for (const button of this.gameButtons.children) button.setAttribute("aria-pressed", String(button.dataset.game === this.game));
  }
}

new CardPage().start();
