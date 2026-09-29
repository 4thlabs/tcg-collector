// Games to collect: an explicit list, or every id from 1 to a maximum.

export class GameSelection {
  /** As of 2026-09-29, published games range from 1 to 25; the margin covers games added later. */
  static readonly defaultMaxGameId = 40;

  readonly ids: readonly number[];

  private constructor(ids: readonly number[]) {
    this.ids = ids;
  }

  /** "all" (or empty) = ids 1 to defaultMaxGameId, otherwise a list such as "1,6,21". */
  static parse(value: string | undefined): GameSelection {
    const text = (value ?? "").trim();
    if (text === "" || text === "all") return GameSelection.upTo(GameSelection.defaultMaxGameId);
    const ids = text.split(",").map((part) => Number(part.trim()));
    const invalid = ids.filter((id) => !Number.isInteger(id) || id < 1);
    if (invalid.length > 0) throw new Error(`Invalid game ids: "${value}"`);
    return new GameSelection([...new Set(ids)].sort((a, b) => a - b));
  }

  static upTo(maxGameId: number): GameSelection {
    return new GameSelection(Array.from({ length: maxGameId }, (_, i) => i + 1));
  }
}
