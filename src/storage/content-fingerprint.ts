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
    const json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    for (const field of ContentFingerprint.volatileFields) delete json[field];
    return createHash("sha256").update(JSON.stringify(json)).digest("hex");
  }
}
