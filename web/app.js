// Card page: searches the catalogue through the tcg-collector API, lists the cards with image and trend price,
// and opens a card's sheet (latest prices, daily chart) on click.
// Plain browser JavaScript, no build step; Chart.js is served by the same server (vendor/chart.js).
"use strict";

const GAMES = {
  1: { name: "Magic", cardmarket: "Magic" },
  21: { name: "Star Wars Unlimited", cardmarket: "StarWarsUnlimited" },
};

/** Calls the JSON API of the server; errors carry the server's message. */
class Api {
  async get(path, params) {
    const query = new URLSearchParams(params);
    const response = await fetch(`${path}?${query}`);
    // An error page may not be JSON: the status then tells what went wrong.
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }

    return body;
  }

  search(params) {
    return this.get("api/search", params);
  }

  async card(game, product) {
    const body = await this.get("api/card", { game, product });

    return body.card;
  }

  async expansions(game) {
    const body = await this.get("api/expansions", { game });

    return body.expansions;
  }

  /** Day of the game's latest archived price guide (YYYY-MM-DD), or null. */
  async latestDay(game) {
    const body = await this.get("api/latest", { game });

    return body.day;
  }

  async latestPrices(game, product) {
    const body = await this.get("api/prices", { game, product });

    return body.prices;
  }

  async dailyPrices(game, product, days) {
    const body = await this.get("api/daily", { game, product, days });

    return body.days;
  }

  /**
   * Card image, cached by the server (Scryfall for Magic, starwarsunlimited.com for Star Wars Unlimited);
   * 404 when there is none.
   */
  imageUrl(game, product, size) {
    const query = new URLSearchParams({ game, product, size });

    return `api/image?${query}`;
  }
}

/** The page's state lives in the address, so a search or a card can be bookmarked and the back button works. */
class PageState {
  static fields = ["game", "q", "expansion", "kind", "min", "max", "sort", "card"];
  static defaults = { game: "1", q: "", expansion: "", kind: "all", min: "", max: "", sort: "relevance", card: "" };

  static read() {
    const params = new URLSearchParams(location.search);
    const state = { ...PageState.defaults };

    for (const field of PageState.fields) {
      if (params.has(field)) {
        state[field] = params.get(field);
      }
    }

    if (!GAMES[state.game]) {
      state.game = PageState.defaults.game;
    }

    return state;
  }

  static write(state, push = false) {
    const params = new URLSearchParams();

    for (const field of PageState.fields) {
      const value = state[field];

      // Default values stay out of the address, to keep it short.
      if (!value || value === PageState.defaults[field]) {
        continue;
      }

      params.set(field, value);
    }

    const url = params.size ? `?${params}` : location.pathname;

    if (push) {
      history.pushState(null, "", url);
    } else {
      history.replaceState(null, "", url);
    }
  }
}

/** Display helpers shared by the list and the sheet. */
class Format {
  static euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

  static price(value) {
    return value == null ? "—" : Format.euro.format(value);
  }

  static expansion(card) {
    if (card.expansion != null) {
      return card.expansion;
    }

    if (card.expansionId == null) {
      return "Unknown expansion";
    }

    return `Expansion ${card.expansionId}`;
  }

  static version(card) {
    return card.version == null ? "" : `V.${card.version}`;
  }

  static cardmarketUrl(game, card) {
    const product = encodeURIComponent(card.product);

    return `https://www.cardmarket.com/en/${GAMES[game].cardmarket}/Products?idProduct=${product}`;
  }

  /** "low €1.20 · foil €3.40", leaving out the prices the card does not have. */
  static otherPrices(card) {
    const parts = [];

    if (card.low != null) {
      parts.push(`low ${Format.price(card.low)}`);
    }

    if (card.trendFoil != null) {
      parts.push(`foil ${Format.price(card.trendFoil)}`);
    }

    return parts.join(" · ");
  }

  /** A short message paragraph, styled as an error when isError. */
  static note(text, isError = false) {
    const p = document.createElement("p");

    p.className = isError ? "note err" : "note";
    p.textContent = text;

    return p;
  }

  /** Name with its version badge. */
  static nameInto(element, card) {
    element.textContent = card.name;
    if (card.version == null) {
      return;
    }

    const badge = document.createElement("span");

    badge.className = "version";
    badge.textContent = Format.version(card);
    element.append(badge);
  }
}

/** Header line telling how recent the game's prices are. */
class LatestDay {
  constructor(api) {
    this.api = api;
    this.element = document.getElementById("latest");
    this.game = null;
  }

  async show(game) {
    if (this.game === game) {
      return;
    }

    this.game = game;
    this.element.textContent = "";
    try {
      const day = await this.api.latestDay(game);

      // Another game may have been chosen meanwhile.
      if (this.game !== game) {
        return;
      }

      this.element.textContent = day ? `Latest prices: ${day}.` : "No prices imported yet.";
    } catch {
      // The page works without it.
    }
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
    for (const field of ["q", "kind", "min", "max", "sort"]) {
      this.form.elements[field].value = state[field];
    }

    this.expansionSelect.value = state.expansion;
  }

  /** Loads the expansions of the game (newest first), keeping the selected one. */
  async loadExpansions(game, selected) {
    if (this.loadedGame === game) {
      return;
    }

    this.loadedGame = game;
    const allExpansions = this.expansionSelect.options[0];

    this.expansionSelect.replaceChildren(allExpansions);
    try {
      const expansions = await this.api.expansions(game);

      // Another game may have been chosen meanwhile.
      if (this.loadedGame !== game) {
        return;
      }

      const options = expansions.map((expansion) => {
        const label = `${expansion.label} (${expansion.count})`;

        return new Option(label, String(expansion.id));
      });

      this.expansionSelect.append(...options);
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
    /** Number of the latest request: the answers to older ones are dropped. */
    this.sequence = 0;
    this.params = null;
    this.shown = 0;
    this.total = 0;
    this.more.addEventListener("click", () => this.load(false));
  }

  /** New search, from the first page. */
  search(params) {
    this.params = params;
    this.shown = 0;

    return this.load(true);
  }

  /** Loads the next page; `fresh` replaces the list instead of adding to it. */
  async load(fresh) {
    this.sequence++;
    const sequence = this.sequence;

    this.more.disabled = true;
    if (fresh) {
      this.summary.textContent = "Searching…";
    }

    try {
      const page = { ...this.params, offset: this.shown, limit: ResultList.pageSize };
      const result = await this.api.search(page);

      if (sequence !== this.sequence) {
        return;
      }

      const items = result.cards.map((card) => this.item(card));

      if (fresh) {
        this.list.replaceChildren(...items);
      } else {
        this.list.append(...items);
      }

      this.shown += result.cards.length;
      this.total = result.total;
      this.summary.classList.remove("err");
      this.summary.textContent = this.summaryText();
      this.more.hidden = this.shown >= this.total;
    } catch (error) {
      if (sequence !== this.sequence) {
        return;
      }

      this.summary.classList.add("err");
      this.summary.textContent = `Search failed: ${error.message}.`;
    } finally {
      this.more.disabled = false;
    }
  }

  /** "1,234 products, 60 shown", or a message when nothing matches. */
  summaryText() {
    if (this.total === 0) {
      return "No product matches these filters.";
    }

    const count = `${this.total.toLocaleString("en")} products`;

    if (this.total <= this.shown) {
      return count;
    }

    return `${count}, ${this.shown} shown`;
  }

  item(card) {
    const item = this.template.content.firstElementChild.cloneNode(true);

    this.fillThumb(item.querySelector(".thumb"), card);
    Format.nameInto(item.querySelector(".name"), card);
    item.querySelector(".expansion").textContent = Format.expansion(card);
    item.querySelector(".trend").textContent = card.trend == null ? "no trend" : Format.price(card.trend);
    item.querySelector(".low").textContent = Format.otherPrices(card);
    item.querySelector(".card").addEventListener("click", () => this.onOpen(card));

    return item;
  }

  /** The first letter shows until the image loads, and stays when there is none. */
  fillThumb(thumb, card) {
    thumb.textContent = card.name.slice(0, 1);
    const image = new Image();

    image.loading = "lazy";
    image.alt = "";
    image.addEventListener("error", () => image.remove());
    image.src = this.api.imageUrl(this.params.game, card.product, "small");
    thumb.append(image);
  }
}

/** Line chart of the daily prices, drawn with the theme's colors. */
class PriceChart {
  static series = [
    { field: "low", label: "Low", color: "--accent", line: "solid" },
    { field: "trend", label: "Trend", color: "--fg", line: "solid" },
    { field: "avg30", label: "30-day avg", color: "--muted", line: "dashed" },
    // The 1-day averages follow the day's sales, so they are noisier: thin dotted lines.
    { field: "avg1", label: "1-day avg", color: "--fg", line: "dotted" },
    { field: "low_foil", label: "Low foil", color: "--foil", line: "dashed" },
    { field: "trend_foil", label: "Trend foil", color: "--foil", line: "solid" },
    { field: "avg1_foil", label: "1-day avg foil", color: "--foil", line: "dotted" },
  ];

  /** Width and dash pattern of each line style. */
  static lines = {
    solid: { width: 2, dash: [] },
    dashed: { width: 1.5, dash: [5, 4] },
    dotted: { width: 1.5, dash: [1, 3] },
  };

  /** Beyond about a year, the axis labels also show the year. */
  static longPeriodDays = 370;

  constructor(canvas, note) {
    this.canvas = canvas;
    this.note = note;
    this.chart = null;
    this.days = [];
  }

  draw(days) {
    this.days = days;
    this.clear();
    if (!days.length) {
      this.message("No price over this period.");

      return;
    }

    if (!window.Chart) {
      this.message("The chart library could not load.", true);

      return;
    }

    const theme = getComputedStyle(document.documentElement);
    const color = (name) => theme.getPropertyValue(name).trim();
    const muted = color("--muted");
    const grid = color("--line");
    // Only the series with at least one price in the period.
    const hasPrice = (series) => days.some((day) => day[series.field] != null);
    const datasets = PriceChart.series.filter(hasPrice).map((series) => PriceChart.dataset(series, days, color));
    const withYear = days.length > PriceChart.longPeriodDays;
    const narrow = this.canvas.clientWidth < 500;

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
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${Format.price(item.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: grid },
            ticks: {
              color: muted,
              maxRotation: 0,
              maxTicksLimit: narrow ? 4 : 8,
              callback(value) {
                const day = this.getLabelForValue(value);

                return PriceChart.shortDay(day, withYear);
              },
            },
          },
          y: {
            grid: { color: grid },
            ticks: { color: muted, callback: (value) => Format.price(value) },
          },
        },
      },
    });
  }

  redraw() {
    if (!this.chart) {
      return;
    }

    this.draw(this.days);
  }

  clear() {
    this.chart?.destroy();
    this.chart = null;
    this.note.replaceChildren();
  }

  message(text, isError = false) {
    this.note.replaceChildren(Format.note(text, isError));
  }

  /** One line of the chart: a stepped line, since a price holds until the next price guide. */
  static dataset(series, days, color) {
    const style = PriceChart.lines[series.line];

    return {
      label: series.label,
      data: days.map((day) => day[series.field]),
      borderColor: color(series.color),
      backgroundColor: color(series.color),
      borderWidth: style.width,
      borderDash: style.dash,
      pointRadius: 0,
      pointHoverRadius: 3,
      stepped: true,
    };
  }

  /** "2026-10-03" -> "03/10", or "03/10/26" with the year. */
  static shortDay(day, withYear) {
    const dayAndMonth = `${day.slice(8, 10)}/${day.slice(5, 7)}`;

    if (!withYear) {
      return dayAndMonth;
    }

    return `${dayAndMonth}/${day.slice(2, 4)}`;
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
    const canvas = this.dialog.querySelector("canvas");
    const chartNote = this.dialog.querySelector(".chart-note");

    this.chart = new PriceChart(canvas, chartNote);
    this.range = this.dialog.querySelector(".range");
    this.card = null;
    this.game = null;
    this.days = 90;

    this.dialog.querySelector(".close").addEventListener("click", () => this.dialog.close());
    // A click on the backdrop (outside the sheet) closes it.
    this.dialog.addEventListener("click", (event) => {
      if (event.target !== this.dialog) {
        return;
      }

      this.dialog.close();
    });
    this.dialog.addEventListener("close", () => {
      this.card = null;
      this.chart.clear();
      onClose();
    });
    this.range.addEventListener("click", (event) => this.rangeClicked(event));
  }

  get isOpen() {
    return this.dialog.open;
  }

  /** Opens the sheet of a card from the list (or known only by its id when the server does not find it). */
  open(game, card) {
    this.game = game;
    this.card = card;
    this.render();
    if (!this.dialog.open) {
      this.dialog.showModal();
    }

    this.loadLatest();
    this.loadDaily();
  }

  close() {
    if (!this.dialog.open) {
      return;
    }

    this.dialog.close();
  }

  render() {
    const { game, card } = this;

    Format.nameInto(this.dialog.querySelector(".card-name"), card);
    this.setText(".card-game", GAMES[game].name);
    this.setText(".card-id", card.product);
    this.setText(".card-expansion", CardSheet.expansionLine(card));
    this.setText(".card-added", card.added ? `added ${card.added}` : "");
    this.setText(".asof", "");
    this.dialog.querySelector(".card-link").href = Format.cardmarketUrl(game, card);
    this.dialog.querySelector(".tiles").replaceChildren(Format.note("Loading prices…"));
    this.showArt();
    this.showRange();
  }

  setText(selector, value) {
    this.dialog.querySelector(selector).textContent = value;
  }

  /** A new image each time, so the previous card's art never shows while this one loads. */
  showArt() {
    const art = this.dialog.querySelector(".art");
    const image = new Image();

    image.alt = this.card.name;
    image.addEventListener("load", () => image.classList.add("loaded"));
    image.addEventListener("error", () => {
      art.hidden = true;
    });
    art.hidden = false;
    art.replaceChildren(image);
    image.src = this.api.imageUrl(this.game, this.card.product, "normal");
  }

  rangeClicked(event) {
    const button = event.target.closest("button[data-days]");

    if (!button) {
      return;
    }

    this.days = Number(button.dataset.days);
    this.showRange();
    this.loadDaily();
  }

  showRange() {
    for (const button of this.range.children) {
      const pressed = Number(button.dataset.days) === this.days;

      button.setAttribute("aria-pressed", String(pressed));
    }
  }

  async loadLatest() {
    const card = this.card;
    const tiles = this.dialog.querySelector(".tiles");

    try {
      const prices = await this.api.latestPrices(this.game, card.product);

      // Another card may have been opened meanwhile.
      if (card !== this.card) {
        return;
      }

      if (!prices) {
        tiles.replaceChildren(Format.note("No archived price for this product."));

        return;
      }

      // Foil tiles only show for a card that has a foil price.
      const shown = CardSheet.fields.filter(({ field, foil }) => !foil || prices[field] != null);

      tiles.replaceChildren(...shown.map((entry) => CardSheet.tile(entry, prices)));
      this.setText(".asof", `Latest archived price guide: ${prices.day}`);
    } catch (error) {
      if (card !== this.card) {
        return;
      }

      tiles.replaceChildren(Format.note(`Prices failed: ${error.message}.`, true));
    }
  }

  async loadDaily() {
    const card = this.card;
    const days = this.days;

    this.chart.clear();
    try {
      const rows = await this.api.dailyPrices(this.game, card.product, days);

      // Another card or period may have been chosen meanwhile.
      if (card !== this.card || days !== this.days) {
        return;
      }

      this.chart.draw(rows);
    } catch (error) {
      if (card !== this.card) {
        return;
      }

      this.chart.message(`Daily prices failed: ${error.message}.`, true);
    }
  }

  /** "Expansion · V.2"; empty for a card known only by its id (opened from the address). */
  static expansionLine(card) {
    if (card.expansionId === undefined) {
      return "";
    }

    const parts = [Format.expansion(card), Format.version(card)];

    return parts.filter(Boolean).join(" · ");
  }

  static tile({ field, label, foil }, prices) {
    const tile = document.createElement("div");

    tile.classList.add("tile");
    tile.classList.toggle("foil", foil);
    tile.classList.toggle("empty", prices[field] == null);
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

/** Wires the game switch, the filters, the list and the sheet to the state in the address. */
class CardPage {
  constructor() {
    this.api = new Api();
    this.state = PageState.read();
    this.gameButtons = document.getElementById("game");
    this.latestDay = new LatestDay(this.api);
    this.filters = new Filters(this.api, () => this.filtersChanged());
    this.results = new ResultList(this.api, (card) => this.openCard(card));
    this.sheet = new CardSheet(this.api, () => this.sheetClosed());
  }

  async start() {
    this.gameButtons.addEventListener("click", (event) => this.gameClicked(event));
    // Back and forward buttons: show the state of that address.
    addEventListener("popstate", () => {
      this.state = PageState.read();
      this.render();
    });
    // The chart reads the theme's colors when it draws: it is redrawn when the theme changes.
    const darkTheme = matchMedia("(prefers-color-scheme: dark)");

    darkTheme.addEventListener("change", () => this.sheet.chart.redraw());
    await this.render();
  }

  async render() {
    for (const button of this.gameButtons.children) {
      const pressed = button.dataset.game === this.state.game;

      button.setAttribute("aria-pressed", String(pressed));
    }

    this.filters.show(this.state);
    this.latestDay.show(this.state.game);
    const expansionsLoaded = this.filters.loadExpansions(this.state.game, this.state.expansion);

    this.results.search(this.searchParams());
    await expansionsLoaded;

    // Read the state again: it may have changed while the expansions loaded.
    if (!this.state.card) {
      this.sheet.close();

      return;
    }

    const alreadyOpen = this.sheet.card?.product === this.state.card;

    if (!alreadyOpen) {
      await this.openFromAddress(this.state.game, this.state.card);
    }
  }

  /** A new game starts a new search, keeping only the kind and the sort order. */
  gameClicked(event) {
    const button = event.target.closest("button[data-game]");

    if (!button || button.dataset.game === this.state.game) {
      return;
    }

    const { kind, sort } = this.state;

    this.state = { ...PageState.defaults, game: button.dataset.game, kind, sort };
    PageState.write(this.state, true);
    this.render();
  }

  /** A card named in the address: its details come from the server. */
  async openFromAddress(game, product) {
    const card = await this.api.card(game, product).catch(() => null);

    // The address may have changed while the card loaded.
    if (this.state.card !== product) {
      return;
    }

    // A card the server does not find still opens, under its id.
    const shown = card ?? { product, name: `#${product}` };

    this.sheet.open(game, shown);
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
    if (!this.state.card) {
      return;
    }

    this.state = { ...this.state, card: "" };
    PageState.write(this.state, true);
  }

  searchParams() {
    const { game, q, expansion, kind, min, max, sort } = this.state;

    return { game, q, expansion, kind, min, max, sort };
  }
}

new CardPage().start();
