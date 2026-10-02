// Names an expansion after its sealed products: Cardmarket's public files have expansion ids, but no expansion names.
export class ExpansionLabel {
  private static readonly fullSet = /^(.*?):? Full Set(?: \(.*\))?$/i;
  private static readonly raritySet = /^(.*?):? (?:Rare|Common|Uncommon|Leader|Legendary|Base) Set$/i;
  /** Commander and starter decks: X: "Deck name" (quotes doubled in Cardmarket's files). */
  private static readonly deck = /^(.*?): ""/;
  private static readonly packaging = /[: ]+(?:Foil Promo Pack|Promo Pack|Prerelease Promo|Booster Box|Booster Display|Booster|Display|Bundle|Prerelease Pack|Deck|Box)\b.*$/i;

  /**
   * Best guess from the names of an expansion's sealed products, in this order: "X: Full Set", "X Rare Set",
   * the shortest deck prefix, the words all the names share, then the shortest name without its packaging.
   * Null when the expansion has no sealed product.
   */
  static fromSealedNames(names: readonly string[]): string | null {
    for (const pattern of [ExpansionLabel.fullSet, ExpansionLabel.raritySet]) {
      const match = names.map((name) => pattern.exec(name)).find((m) => m !== null);
      if (match) return ExpansionLabel.clean(match[1]);
    }
    const decks = names.map((name) => ExpansionLabel.deck.exec(name)?.[1]).filter((prefix) => prefix !== undefined);
    if (decks.length > 0) return ExpansionLabel.clean(ExpansionLabel.shortest(decks));
    const shared = ExpansionLabel.sharedWords(names);
    if (shared.length >= 4) return shared;
    if (names.length === 0) return null;
    const shortest = ExpansionLabel.shortest(names);
    return ExpansionLabel.clean(shortest.replace(ExpansionLabel.packaging, "")) || shortest;
  }

  /** Leading words common to every name (at least two names), without a trailing separator. */
  private static sharedWords(names: readonly string[]): string {
    if (names.length < 2) return "";
    const words = names.map((name) => name.split(" "));
    const shared: string[] = [];
    for (let i = 0; words.every((w) => w[i] !== undefined && w[i] === words[0][i]); i++) shared.push(words[0][i]);
    return ExpansionLabel.clean(shared.join(" ").replace(/[:\-–]$/, ""));
  }

  private static shortest(names: readonly string[]): string {
    return names.reduce((a, b) => (b.length < a.length ? b : a));
  }

  private static clean(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
}
