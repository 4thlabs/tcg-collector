// Empreinte du contenu utile d'un fichier Cardmarket.
import { createHash } from "node:crypto";

/**
 * Cardmarket régénère ses fichiers en changeant le champ « createdAt » en tête du JSON :
 * le hash du fichier entier change alors même si aucune carte ni aucun prix n'a bougé.
 * L'empreinte est donc calculée sur le JSON privé de ce champ.
 */
export class ContentFingerprint {
  private static readonly volatileFields = ["createdAt"];

  static of(body: Buffer): string {
    const json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    for (const field of ContentFingerprint.volatileFields) delete json[field];
    return createHash("sha256").update(JSON.stringify(json)).digest("hex");
  }
}
