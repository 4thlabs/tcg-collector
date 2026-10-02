// Card page: searches the catalogue through the tcg-collector API, lists the cards with image and trend price,
// and opens a card's sheet (latest prices, daily chart) on click.
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

  search(params) {
    return this.get("api/search", params);
  }

  async card(game, product) {
    return (await this.get("api/card", { game, product })).card;
  }

  async expansions(game) {
    return (await this.get("api/expansions", { game })).expansions;
  }

  async latestPrices(game, product) {
    return (await this.get("api/prices", { game, product })).prices;
  }

  async dailyPrices(game, product, days) {
    return (await this.get("api/daily", { game, product, days })).days;
  }

  /** Card image, cached by the server (Scryfall for Magic, starwarsunlimited.com for Star Wars Unlimited); 404 when there is none. */
  imageUrl(game, product, size) {
    return `api/image?${new URLSearchParams({ game, product, size })}`;
  }
}

/** The page's state lives in the address, so a search or a card can be bookmarked and the back button works. */
class PageState {
  static fields = ["game", "q", "expansion", "kind", "min", "max", "sort", "card"];
  static defaults = { game: "1", q: "", expansion: "", kind: "all", min: "", max: "", sort: "relevance", card: "" };

  static read() {
    const params = new URLSearchParams(location.search);
    const state = { ...PageState.defaults };
    for (const field of PageState.fields) if (params.has(field)) state[field] = params.get(field);
    if (!GAMES[state.game]) state.game = PageState.defaults.game;
    return state;
  }

  static write(state, push = false) {
    const params = new URLSearchParams();
    for (const field of PageState.fields) if (state[field] && state[field] !== PageState.defaults[field]) params.set(field, state[field]);
    const url = params.size ? `?${params}` : location.pathname;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
}

/** Display helpers shared by the list and the sheet. */
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

  static cardmarketUrl(game, card) {
    return `https://www.cardmarket.com/en/${GAMES[game].cardmarket}/Products?idProduct=${encodeURIComponent(card.product)}`;
  }

  /** Name with its version badge. */
  static nameInto(element, card) {
    element.textContent = card.name;
    if (card.version == null) return;
    const badge = document.createElement("span");
    badge.className = "version";
    badge.textContent = Format.version(card);
    element.append(badge);
  }
}

/** The filter form: reads and writes the filter part of the state, and fills the expansion list per game. */
class Filters {
  constructor(api, onChange) {
    this.api = api;
    this.form = document.getElementById("filters");
    this.expansionSelect = this.form.elements.expansion;
    this.loadedGame = null;
    let timer = null;
    // Typing waits a little; lists apply at once.
    this.form.addEventListener("input", (event) => {
      clearTimeout(timer);
      const delay = event.target.tagName === "SELECT" ? 0 : 300;
      timer = setTimeout(onChange, delay);
    });
    this.form.addEventListener("submit", (event) => event.preventDefault());
  }

  values() {
    const elements = this.form.elements;
    return {
      q: elements.q.value.trim(),
      expansion: elements.expansion.value,
      kind: elements.kind.value,
      min: elements.min.value,
      max: elements.max.value,
      sort: elements.sort.value,
    };
  }

  show(state) {
    for (const field of ["q", "kind", "min", "max", "sort"]) this.form.elements[field].value = state[field];
    this.expansionSelect.value = state.expansion;
  }

  /** Loads the expansions of the game (newest first), keeping the selected one. */
  async loadExpansions(game, selected) {
    if (this.loadedGame === game) return;
    this.loadedGame = game;
    const first = this.expansionSelect.options[0];
    this.expansionSelect.replaceChildren(first);
    try {
      const expansions = await this.api.expansions(game);
      if (this.loadedGame !== game) return;
      this.expansionSelect.append(...expansions.map((expansion) => new Option(`${expansion.label} (${expansion.count})`, String(expansion.id))));
    } catch {
      // The list still works without the expansion filter.
    }
    this.expansionSelect.value = selected;
  }
}

/** The grid of results, with "Show more" paging. */
class ResultList {
  static pageSize = 60;

  constructor(api, onOpen) {
    this.api = api;
    this.onOpen = onOpen;
    this.list = document.getElementById("cards");
    this.summary = document.getElementById("summary");
    this.more = document.getElementById("more");
    this.template = document.getElementById("card-template");
    this.sequence = 0;
    this.params = null;
    this.shown = 0;
    this.total = 0;
    this.more.addEventListener("click", () => this.load(false));
  }

  /** New search: answers to older searches are dropped. */
  search(params) {
    this.params = params;
    this.shown = 0;
    return this.load(true);
  }

  async load(fresh) {
    const sequence = ++this.sequence;
    this.more.disabled = true;
    if (fresh) this.summary.textContent = "Searching…";
    try {
      const result = await this.api.search({ ...this.params, offset: this.shown, limit: ResultList.pageSize });
      if (sequence !== this.sequence) return;
      const items = result.cards.map((card) => this.item(card));
      if (fresh) this.list.replaceChildren(...items);
      else this.list.append(...items);
      this.shown += result.cards.length;
      this.total = result.total;
      this.summary.classList.remove("err");
      this.summary.textContent = this.total === 0 ? "No product matches these filters." : `${this.total.toLocaleString("en")} products${this.total > this.shown ? `, ${this.shown} shown` : ""}`;
      this.more.hidden = this.shown >= this.total;
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.summary.classList.add("err");
      this.summary.textContent = `Search failed: ${error.message}.`;
    } finally {
      this.more.disabled = false;
    }
  }

  item(card) {
    const item = this.template.content.firstElementChild.cloneNode(true);
    const game = this.params.game;
    const thumb = item.querySelector(".thumb");
    const imageUrl = this.api.imageUrl(game, card.product, "small");
    // The first letter shows until the image loads, and stays when there is none.
    thumb.textContent = card.name.slice(0, 1);
    if (imageUrl) {
      const image = new Image();
      image.loading = "lazy";
      image.alt = "";
      image.addEventListener("error", () => image.remove());
      image.src = imageUrl;
      thumb.append(image);
    }
    Format.nameInto(item.querySelector(".name"), card);
    item.querySelector(".expansion").textContent = Format.expansion(card);
    item.querySelector(".trend").textContent = card.trend == null ? "no trend" : Format.price(card.trend);
    item.querySelector(".low").textContent = [card.low != null && `low ${Format.price(card.low)}`, card.trendFoil != null && `foil ${Format.price(card.trendFoil)}`].filter(Boolean).join(" · ");
    item.querySelector(".card").addEventListener("click", () => this.onOpen(card));
    return item;
  }
}

/** Line chart of the daily prices, drawn with the theme's colors. */
class PriceChart {
  static series = [
    { field: "low", label: "Low", color: "--accent", line: "solid" },
    { field: "trend", label: "Trend", color: "--fg", line: "solid" },
    { field: "avg30", label: "30-day avg", color: "--muted", line: "dashed" },
    { field: "low_foil", label: "Low foil", color: "--foil", line: "dashed" },
    { field: "trend_foil", label: "Trend foil", color: "--foil", line: "solid" },
    // The 1-day average follows the day's sales, so it is noisier: thin dotted line.
    { field: "avg1_foil", label: "1-day avg foil", color: "--foil", line: "dotted" },
  ];

  /** Width and dash pattern of each line style. */
  static lines = {
    solid: { width: 2, dash: [] },
    dashed: { width: 1.5, dash: [5, 4] },
    dotted: { width: 1.5, dash: [1, 3] },
  };

  constructor(canvas, note) {
    this.canvas = canvas;
    this.note = note;
    this.chart = null;
    this.days = [];
  }

  draw(days) {
    this.days = days;
    this.clear();
    if (!days.length) return this.message("No price over this period.");
    if (!window.Chart) return this.message("The chart library could not load.", true);
    const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const muted = color("--muted");
    const grid = color("--line");
    const datasets = PriceChart.series
      .filter(({ field }) => days.some((day) => day[field] != null))
      .map(({ field, label, color: token, line }) => ({
        label,
        data: days.map((day) => day[field]),
        borderColor: color(token),
        backgroundColor: color(token),
        borderWidth: PriceChart.lines[line].width,
        borderDash: PriceChart.lines[line].dash,
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

  clear() {
    this.chart?.destroy();
    this.chart = null;
    this.note.replaceChildren();
  }

  message(text, isError = false) {
    const p = document.createElement("p");
    p.className = isError ? "note err" : "note";
    p.textContent = text;
    this.note.replaceChildren(p);
  }
}

/** The selected card's sheet, in a dialog: image, latest prices and daily chart. */
class CardSheet {
  static fields = [
    { field: "low", label: "Low", foil: false },
    { field: "trend", label: "Trend", foil: false },
    { field: "avg30", label: "30-day avg", foil: false },
    { field: "low_foil", label: "Low foil", foil: true },
    { field: "trend_foil", label: "Trend foil", foil: true },
    { field: "avg30_foil", label: "30-day avg foil", foil: true },
  ];

  constructor(api, onClose) {
    this.api = api;
    this.dialog = document.getElementById("sheet");
    this.chart = new PriceChart(this.dialog.querySelector("canvas"), this.dialog.querySelector(".chart-note"));
    this.range = this.dialog.querySelector(".range");
    this.card = null;
    this.game = null;
    this.days = 90;
    this.dialog.querySelector(".close").addEventListener("click", () => this.dialog.close());
    // A click on the backdrop (outside the sheet) closes it.
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener("close", () => {
      this.card = null;
      this.chart.clear();
      onClose();
    });
    this.range.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-days]");
      if (!button) return;
      this.days = Number(button.dataset.days);
      this.showRange();
      this.loadDaily();
    });
  }

  get isOpen() {
    return this.dialog.open;
  }

  /** Opens the sheet of a card from the list (or known only by its id when the server does not find it). */
  open(game, card) {
    this.game = game;
    this.card = card;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.loadLatest();
    this.loadDaily();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  render() {
    const { game, card } = this;
    const text = (selector, value) => (this.dialog.querySelector(selector).textContent = value);
    Format.nameInto(this.dialog.querySelector(".card-name"), card);
    text(".card-game", GAMES[game].name);
    text(".card-id", card.product);
    text(".card-expansion", card.expansionId === undefined ? "" : [Format.expansion(card), Format.version(card)].filter(Boolean).join(" · "));
    text(".card-added", card.added ? `added ${card.added}` : "");
    text(".asof", "");
    this.dialog.querySelector(".card-link").href = Format.cardmarketUrl(game, card);
    this.dialog.querySelector(".tiles").replaceChildren(CardSheet.note("Loading prices…"));

    // A new image each time, so the previous card's art never shows while this one loads: the placeholder background does.
    const art = this.dialog.querySelector(".art");
    const imageUrl = this.api.imageUrl(game, card.product, "normal");
    const image = new Image();
    image.alt = card.name;
    image.addEventListener("load", () => image.classList.add("loaded"));
    image.addEventListener("error", () => (art.hidden = true));
    art.hidden = !imageUrl;
    art.replaceChildren(image);
    if (imageUrl) image.src = imageUrl;
    this.showRange();
  }

  showRange() {
    for (const button of this.range.children) button.setAttribute("aria-pressed", String(Number(button.dataset.days) === this.days));
  }

  async loadLatest() {
    const card = this.card;
    const tiles = this.dialog.querySelector(".tiles");
    try {
      const prices = await this.api.latestPrices(this.game, card.product);
      if (card !== this.card) return;
      if (!prices) return tiles.replaceChildren(CardSheet.note("No archived price for this product."));
      tiles.replaceChildren(...CardSheet.fields.filter(({ field, foil }) => !foil || prices[field] != null).map((entry) => CardSheet.tile(entry, prices)));
      this.dialog.querySelector(".asof").textContent = `Latest archived price guide: ${prices.day}`;
    } catch (error) {
      if (card === this.card) tiles.replaceChildren(CardSheet.note(`Prices failed: ${error.message}.`, true));
    }
  }

  async loadDaily() {
    const card = this.card;
    const days = this.days;
    this.chart.clear();
    try {
      const rows = await this.api.dailyPrices(this.game, card.product, days);
      if (card === this.card && days === this.days) this.chart.draw(rows);
    } catch (error) {
      if (card === this.card) this.chart.message(`Daily prices failed: ${error.message}.`, true);
    }
  }

  static tile({ field, label, foil }, prices) {
    const tile = document.createElement("div");
    tile.className = `tile${foil ? " foil" : ""}${prices[field] == null ? " empty" : ""}`;
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = Format.price(prices[field]);
    tile.append(name, value);
    return tile;
  }

  static note(text, isError = false) {
    const p = document.createElement("p");
    p.className = isError ? "note err" : "note";
    p.textContent = text;
    return p;
  }
}

/** Wires the game switch, the filters, the list and the sheet to the state in the address. */
class CardPage {
  constructor() {
    this.api = new Api();
    this.state = PageState.read();
    this.gameButtons = document.getElementById("game");
    this.filters = new Filters(this.api, () => this.filtersChanged());
    this.results = new ResultList(this.api, (card) => this.openCard(card));
    this.sheet = new CardSheet(this.api, () => this.sheetClosed());
  }

  async start() {
    this.gameButtons.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-game]");
      if (!button || button.dataset.game === this.state.game) return;
      this.state = { ...PageState.defaults, game: button.dataset.game, sort: this.state.sort, kind: this.state.kind };
      PageState.write(this.state, true);
      this.render();
    });
    // Back and forward buttons: show the state of that address.
    addEventListener("popstate", () => {
      this.state = PageState.read();
      this.render();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.sheet.chart.redraw());
    await this.render();
  }

  async render() {
    for (const button of this.gameButtons.children) button.setAttribute("aria-pressed", String(button.dataset.game === this.state.game));
    this.filters.show(this.state);
    const expansions = this.filters.loadExpansions(this.state.game, this.state.expansion);
    this.results.search(this.searchParams());
    await expansions;
    if (this.state.card) {
      if (this.sheet.card?.product !== this.state.card) await this.openFromAddress(this.state.game, this.state.card);
    } else {
      this.sheet.close();
    }
  }

  /** A card named in the address: its details come from the server. */
  async openFromAddress(game, product) {
    const card = await this.api.card(game, product).catch(() => null);
    if (this.state.card === product) this.sheet.open(game, card ?? { product, name: `#${product}` });
  }

  filtersChanged() {
    this.state = { ...this.state, ...this.filters.values() };
    PageState.write(this.state);
    this.results.search(this.searchParams());
  }

  openCard(card) {
    this.state = { ...this.state, card: card.product };
    PageState.write(this.state, true);
    this.sheet.open(this.state.game, card);
  }

  sheetClosed() {
    if (!this.state.card) return;
    this.state = { ...this.state, card: "" };
    PageState.write(this.state, true);
  }

  searchParams() {
    const { game, q, expansion, kind, min, max, sort } = this.state;
    return { game, q, expansion, kind, min, max, sort };
  }
}

new CardPage().start();
