// Fingerprint of the useful content of a Cardmarket file.
import { createHash } from "node:crypto";

/**
 * Cardmarket regenerates its files with a new "createdAt" field at the top of the JSON:
 * the hash of the whole file then changes even when no card or price moved.
 * The fingerprint is therefore computed on the JSON without that field.
 */
export class ContentFingerprint {
  private static readonly volatileFields = ["createdAt"];

  static of(body: Buffer): string {
    const text = body.toString("utf8");
    const content = JSON.parse(text) as Record<string, unknown>;

    for (const field of ContentFingerprint.volatileFields) {
      delete content[field];
    }

    const canonical = JSON.stringify(content);
    const hash = createHash("sha256");

    hash.update(canonical);

    return hash.digest("hex");
  }
}
