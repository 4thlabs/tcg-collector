// Names an expansion after its sealed products: Cardmarket's public files have expansion ids, but no expansion names.
export class ExpansionLabel {
  private static readonly fullSet = /^(.*?):? Full Set(?: \(.*\))?$/i;
  private static readonly raritySet = /^(.*?):? (?:Rare|Common|Uncommon|Leader|Legendary|Base) Set$/i;
  /** Commander and starter decks: X: "Deck name" (quotes doubled in Cardmarket's files). */
  private static readonly deck = /^(.*?): ""/;
  /** Words that name the packaging, not the expansion. */
  private static readonly packagingWords = [
    "Foil Promo Pack",
    "Promo Pack",
    "Prerelease Promo",
    "Booster Box",
    "Booster Display",
    "Booster",
    "Display",
    "Bundle",
    "Prerelease Pack",
    "Deck",
    "Box",
  ];
  /** The packaging and everything after it: "Foundations Booster Box (English)" -> " Booster Box (English)". */
  private static readonly packaging = new RegExp(`[: ]+(?:${ExpansionLabel.packagingWords.join("|")})\\b.*$`, "i");

  /**
   * Best guess from the names of an expansion's sealed products, in this order: "X: Full Set", "X Rare Set",
   * the shortest deck prefix, the words all the names share, then the shortest name without its packaging.
   * Null when the expansion has no sealed product.
   */
  static fromSealedNames(names: readonly string[]): string | null {
    for (const pattern of [ExpansionLabel.fullSet, ExpansionLabel.raritySet]) {
      const match = ExpansionLabel.firstMatch(names, pattern);
      if (match) {
        return ExpansionLabel.clean(match[1]);
      }
    }

    const deckPrefixes = ExpansionLabel.deckPrefixes(names);
    if (deckPrefixes.length > 0) {
      const shortestPrefix = ExpansionLabel.shortest(deckPrefixes);
      return ExpansionLabel.clean(shortestPrefix);
    }

    const shared = ExpansionLabel.sharedWords(names);
    if (shared.length >= 4) {
      return shared;
    }

    if (names.length === 0) {
      return null;
    }
    const shortest = ExpansionLabel.shortest(names);
    const withoutPackaging = shortest.replace(ExpansionLabel.packaging, "");
    // A name that is only packaging ("Booster Box") keeps its full text.
    return ExpansionLabel.clean(withoutPackaging) || shortest;
  }

  private static firstMatch(names: readonly string[], pattern: RegExp): RegExpExecArray | null {
    for (const name of names) {
      const match = pattern.exec(name);
      if (match) {
        return match;
      }
    }
    return null;
  }

  /** "X" for each deck named X: "Deck name". */
  private static deckPrefixes(names: readonly string[]): string[] {
    const prefixes: string[] = [];
    for (const name of names) {
      const match = ExpansionLabel.deck.exec(name);
      if (!match) {
        continue;
      }
      prefixes.push(match[1]);
    }
    return prefixes;
  }

  /** Leading words common to every name (at least two names), without a trailing separator. */
  private static sharedWords(names: readonly string[]): string {
    if (names.length < 2) {
      return "";
    }
    const [first, ...others] = names.map((name) => name.split(" "));
    const shared: string[] = [];
    for (const [index, word] of first.entries()) {
      if (others.some((words) => words[index] !== word)) {
        break;
      }
      shared.push(word);
    }
    const withoutSeparator = shared.join(" ").replace(/[:\-–]$/, "");
    return ExpansionLabel.clean(withoutSeparator);
  }

  private static shortest(names: readonly string[]): string {
    let shortest = names[0];
    for (const name of names) {
      if (name.length < shortest.length) {
        shortest = name;
      }
    }
    return shortest;
  }

  private static clean(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
}
