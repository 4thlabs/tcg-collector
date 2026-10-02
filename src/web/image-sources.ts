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
    if (!card.single) return null;
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

/** Answer of the database's API (Strapi). */
interface SwuAnswer {
  data: {
    attributes: {
      title: string;
      subtitle: string | null;
      variantTypes?: { data: { attributes: { name: string } }[] };
      artFront?: { data: { attributes: { url: string; formats?: Record<string, { url: string }> } } | null };
    };
  }[];
}

/**
 * Star Wars Unlimited: images of the official card database (starwarsunlimited.com).
 * It has no Cardmarket id, so a product is matched by expansion and "Title, Subtitle". Cardmarket puts
 * the Hyperspace printings of a set in an expansion of their own; in it, a leader has a Hyperspace
 * product without foil price and a Showcase product with one.
 */
export class SwuImages implements ImageSource {
  static readonly api = "https://admin.starwarsunlimited.com/api/cards";
  /** Cardmarket expansion -> set code, and whether it holds the Hyperspace printings. */
  static readonly expansions = new Map<number, { code: string; hyperspace: boolean }>(
    (
      [
        ["SOR", 5618, 5638],
        ["SHD", 5769, 5781],
        ["TWI", 5888, 5937],
        ["JTL", 5995, 6074],
        ["LOF", 6105, 6188],
        ["SEC", 6333, 6364],
        ["LAW", 6451, 6452],
        ["ASH", 6591, 6642],
      ] as const
    ).flatMap(([code, normal, hyperspace]) => [
      [normal, { code, hyperspace: false }],
      [hyperspace, { code, hyperspace: true }],
    ]),
  );

  private readonly http: PoliteHttp;
  /** Cards already looked up, by product, so both sizes cost one lookup. */
  private readonly found = new Map<string, SwuCard | null>();

  constructor(http: PoliteHttp) {
    this.http = http;
  }

  async imageUrl(card: CardEntry, size: ImageSize): Promise<string | null> {
    if (!this.found.has(card.product)) this.found.set(card.product, await this.lookUp(card));
    const found = this.found.get(card.product);
    if (!found) return null;
    return size === "small" ? found.small : found.image;
  }

  private async lookUp(card: CardEntry): Promise<SwuCard | null> {
    if (!card.single) return null;
    const expansion = card.expansionId === null ? undefined : SwuImages.expansions.get(card.expansionId);
    // "Echo Base // Experience Token" is the base; the title starts with the part before the first comma ("No Glory, Only Results" has no subtitle).
    const name = card.name.split(" // ")[0];
    const searchParams: Record<string, string> = { locale: "en", "pagination[pageSize]": "100", "filters[title][$startsWithi]": name.split(", ")[0] };
    // Promos, prerelease and championship expansions are not in the table: any printing of the card shows its art.
    if (expansion) searchParams["filters[expansion][code][$eq]"] = expansion.code;
    const response = await this.http.get(SwuImages.api, { searchParams });
    if (response.status === 404) return null;
    const candidates = SwuImages.cards((await response.json()) as SwuAnswer).filter(
      (candidate) => SwuImages.key(candidate.subtitle ? `${candidate.title}, ${candidate.subtitle}` : candidate.title) === SwuImages.key(name),
    );
    if (!expansion) return candidates.find((candidate) => candidate.variants.includes("Standard")) ?? candidates[0] ?? null;
    return SwuImages.pick(candidates, expansion.hyperspace, card.trendFoil !== null);
  }

  /** The printing that matches a product of a set's expansion: Standard, or Hyperspace / Showcase in the Hyperspace expansion. */
  static pick(candidates: SwuCard[], hyperspace: boolean, hasFoilPrice: boolean): SwuCard | null {
    const variant = (name: string) => candidates.find((card) => card.variants.includes(name));
    if (!hyperspace) return variant("Standard") ?? null;
    return (hasFoilPrice ? variant("Showcase") : undefined) ?? variant("Hyperspace") ?? null;
  }

  private static cards(answer: SwuAnswer): SwuCard[] {
    return answer.data.flatMap(({ attributes: card }) => {
      const art = card.artFront?.data?.attributes;
      if (!art) return [];
      return [
        {
          title: card.title,
          subtitle: card.subtitle || null,
          variants: (card.variantTypes?.data ?? []).map((variant) => variant.attributes.name),
          image: art.url,
          small: art.formats?.xxsmall?.url ?? art.url,
        },
      ];
    });
  }

  /** Names compared without case, accents or punctuation (’ and ' differ between the two sites). */
  private static key(name: string): string {
    return name.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}
