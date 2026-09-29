// Jeux à collecter : une liste explicite, ou tous les identifiants de 1 à un maximum.

export class GameSelection {
  /** Au 2026-09-29, les jeux publiés vont de 1 à 25 ; la marge couvre les jeux ajoutés plus tard. */
  static readonly defaultMaxGameId = 40;

  readonly ids: readonly number[];

  private constructor(ids: readonly number[]) {
    this.ids = ids;
  }

  /** « all » (ou vide) = identifiants 1 à defaultMaxGameId, sinon une liste « 1,6,21 ». */
  static parse(value: string | undefined): GameSelection {
    const text = (value ?? "").trim();
    if (text === "" || text === "all") return GameSelection.upTo(GameSelection.defaultMaxGameId);
    const ids = text.split(",").map((part) => Number(part.trim()));
    const invalid = ids.filter((id) => !Number.isInteger(id) || id < 1);
    if (invalid.length > 0) throw new Error(`Identifiants de jeu invalides : « ${value} »`);
    return new GameSelection([...new Set(ids)].sort((a, b) => a - b));
  }

  static upTo(maxGameId: number): GameSelection {
    return new GameSelection(Array.from({ length: maxGameId }, (_, i) => i + 1));
  }
}
