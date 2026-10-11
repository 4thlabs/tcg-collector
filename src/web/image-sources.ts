// Where each game's card images come from. A source turns a Cardmarket product into an image URL.
import type { ImageSize } from "./card-images.ts";
import type { CardEntry } from "./catalog-index.ts";
import type { PoliteHttp } from "./polite-http.ts";

export interface ImageSource {
  /** URL of the card's image, or null when the source has none for it. */
  imageUrl(card: CardEntry, size: ImageSize): Promise<string | null>;
}

/** Magic: Scryfall finds a card by its Cardmarket idProduct and redirects to the image. */
export class ScryfallImages implements ImageSource {
  async imageUrl(card: CardEntry, size: ImageSize): Promise<string | null> {
    if (!card.single) {
      return null;
    }

    return `https://api.scryfall.com/cards/cardmarket/${card.product}?format=image&version=${size}`;
  }
}

/** A card of the official Star Wars Unlimited database, with only the fields used here. */
interface SwuCard {
  title: string;
  subtitle: string | null;
  /** Standard, Hyperspace, Showcase, Standard Foil, Prerelease Promo… */
  variants: string[];
  /** Full-size image, and the 200 px wide one. */
  image: string;
  small: string;
}

/** Front art of a card in the database, with its smaller formats. */
interface SwuArt {
  url: string;
  formats?: Record<string, { url: string }>;
}

/** Answer of the database's API (Strapi). */
interface SwuAnswer {
  data: {
    attributes: {
      title: string;
      subtitle: string | null;
      variantTypes?: { data: { attributes: { name: string } }[] };
      artFront?: { data: { attributes: SwuArt } | null };
    };
  }[];
}

/** A Cardmarket expansion of a Star Wars Unlimited set. */
interface SwuExpansion {
  code: string;
  /** True for the expansion that holds the set's Hyperspace printings. */
  hyperspace: boolean;
}

/**
 * Star Wars Unlimited: images of the official card database (starwarsunlimited.com).
 * It has no Cardmarket id, so a product is matched by expansion and "Title, Subtitle". Cardmarket puts
 * the Hyperspace printings of a set in an expansion of their own; in it, a leader has a Hyperspace
 * product without foil price and a Showcase product with one.
 */
export class SwuImages implements ImageSource {
  static readonly api = "https://admin.starwarsunlimited.com/api/cards";
  /** Set code, its Cardmarket expansion, and the Cardmarket expansion of its Hyperspace printings. */
  private static readonly sets: readonly (readonly [code: string, normal: number, hyperspace: number])[] = [
    ["SOR", 5618, 5638],
    ["SHD", 5769, 5781],
    ["TWI", 5888, 5937],
    ["JTL", 5995, 6074],
    ["LOF", 6105, 6188],
    ["SEC", 6333, 6364],
    ["LAW", 6451, 6452],
    ["ASH", 6591, 6642],
  ];
  /** Cardmarket expansion id -> its set. */
  private static readonly expansions = SwuImages.expansionsById();

  private readonly http: PoliteHttp;
  /** Cards already looked up, by product, so both sizes cost one lookup. */
  private readonly found = new Map<string, SwuCard | null>();

  constructor(http: PoliteHttp) {
    this.http = http;
  }

  async imageUrl(card: CardEntry, size: ImageSize): Promise<string | null> {
    if (!this.found.has(card.product)) {
      const lookedUp = await this.lookUp(card);

      this.found.set(card.product, lookedUp);
    }

    const found = this.found.get(card.product);

    if (!found) {
      return null;
    }

    if (size === "small") {
      return found.small;
    }

    return found.image;
  }

  private async lookUp(card: CardEntry): Promise<SwuCard | null> {
    if (!card.single) {
      return null;
    }

    // "Echo Base // Experience Token" is the base: only the first face is looked up.
    const name = card.name.split(" // ")[0];
    const expansion = card.expansionId === null ? undefined : SwuImages.expansions.get(card.expansionId);

    const results = await this.search(name, expansion?.code);
    const wanted = SwuImages.key(name);
    const isSameCard = (candidate: SwuCard) => {
      const candidateName = SwuImages.fullName(candidate);

      return SwuImages.key(candidateName) === wanted;
    };

    const candidates = results.filter(isSameCard);

    // Promos, prerelease and championship expansions are not in the table: any printing of the card shows its art.
    if (!expansion) {
      return SwuImages.anyPrinting(candidates);
    }

    return SwuImages.pick(candidates, expansion.hyperspace, card.trendFoil !== null);
  }

  /** Cards whose title starts like the name, in one set when its code is known. */
  private async search(name: string, setCode: string | undefined): Promise<SwuCard[]> {
    // The title is the part before the first comma. "No Glory, Only Results" has no subtitle but still starts that way.
    const title = name.split(", ")[0];
    const searchParams: Record<string, string> = {
      locale: "en",
      "pagination[pageSize]": "100",
      "filters[title][$startsWithi]": title,
    };

    if (setCode) {
      searchParams["filters[expansion][code][$eq]"] = setCode;
    }

    const response = await this.http.get(SwuImages.api, { searchParams });

    if (response.status === 404) {
      return [];
    }

    const answer = (await response.json()) as SwuAnswer;

    return SwuImages.cards(answer);
  }

  private static expansionsById(): Map<number, SwuExpansion> {
    const expansions = new Map<number, SwuExpansion>();

    for (const [code, normal, hyperspace] of SwuImages.sets) {
      expansions.set(normal, { code, hyperspace: false });
      expansions.set(hyperspace, { code, hyperspace: true });
    }

    return expansions;
  }

  /** The Standard printing when there is one, else the first one found. */
  private static anyPrinting(candidates: SwuCard[]): SwuCard | null {
    const standard = candidates.find((card) => card.variants.includes("Standard"));

    if (standard) {
      return standard;
    }

    return candidates[0] ?? null;
  }

  /** The printing that matches a product of a set's expansion: Standard, or Hyperspace / Showcase. */
  private static pick(candidates: SwuCard[], hyperspace: boolean, hasFoilPrice: boolean): SwuCard | null {
    const variant = (name: string) => candidates.find((card) => card.variants.includes(name)) ?? null;

    if (!hyperspace) {
      return variant("Standard");
    }

    // In the Hyperspace expansion, the product with a foil price is the Showcase printing.
    if (hasFoilPrice) {
      const showcase = variant("Showcase");

      if (showcase) {
        return showcase;
      }
    }

    return variant("Hyperspace");
  }

  /** The cards of an answer that have an image. */
  private static cards(answer: SwuAnswer): SwuCard[] {
    const cards: SwuCard[] = [];

    for (const { attributes: card } of answer.data) {
      const art = card.artFront?.data?.attributes;

      if (!art) {
        continue;
      }

      const variantTypes = card.variantTypes?.data ?? [];

      cards.push({
        title: card.title,
        subtitle: card.subtitle || null,
        variants: variantTypes.map((variant) => variant.attributes.name),
        image: art.url,
        small: art.formats?.xxsmall?.url ?? art.url,
      });
    }

    return cards;
  }

  /** "Title, Subtitle", as Cardmarket names the card. */
  private static fullName(card: SwuCard): string {
    if (!card.subtitle) {
      return card.title;
    }

    return `${card.title}, ${card.subtitle}`;
  }

  /** Names compared without case, accents or punctuation (’ and ' differ between the two sites). */
  private static key(name: string): string {
    // NFD splits "é" into "e" and an accent mark, which goes away with the punctuation.
    const decomposed = name.normalize("NFD");
    const lowerCase = decomposed.toLowerCase();

    return lowerCase.replace(/[^a-z0-9]/g, "");
  }
}
