// Accès HTTP aux fichiers publics de Cardmarket (bucket S3, sans authentification).
import type { FeedFile } from "./feed-file.ts";

/** Ce que le serveur dit d'un fichier sans le télécharger (requête HEAD). */
export interface RemoteVersion {
  /** ETag S3 : le MD5 du fichier. Change à chaque régénération, même si le contenu utile est identique. */
  etag: string;
  lastModified: string;
  size: number;
}

export class CardmarketClient {
  static readonly defaultBaseUrl = "https://downloads.s3.cardmarket.com/productCatalog";

  private readonly baseUrl: string;
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(baseUrl = CardmarketClient.defaultBaseUrl, attempts = 3, retryDelayMs = 5_000) {
    this.baseUrl = baseUrl;
    this.attempts = attempts;
    this.retryDelayMs = retryDelayMs;
  }

  /** Version publiée du fichier, ou null s'il n'existe pas (S3 répond 403 pour un fichier absent). */
  async probe(file: FeedFile): Promise<RemoteVersion | null> {
    const response = await this.request(file, "HEAD");
    if (response.status === 403 || response.status === 404) return null;
    this.ensureOk(response, file);
    return {
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
      size: Number(response.headers.get("content-length") ?? 0),
    };
  }

  /** Contenu brut du fichier, tel que publié. */
  async download(file: FeedFile): Promise<Buffer> {
    const response = await this.request(file, "GET");
    this.ensureOk(response, file);
    return Buffer.from(await response.arrayBuffer());
  }

  private urlOf(file: FeedFile): string {
    return `${this.baseUrl}/${file.remotePath}`;
  }

  /** Requête avec nouvelles tentatives sur les erreurs réseau et les erreurs 5xx. */
  private async request(file: FeedFile, method: "HEAD" | "GET"): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const response = await fetch(this.urlOf(file), { method });
        if (response.status < 500) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < this.attempts) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
    }
    throw new Error(`${method} ${this.urlOf(file)} impossible après ${this.attempts} tentatives : ${String(lastError)}`);
  }

  private ensureOk(response: Response, file: FeedFile): void {
    if (!response.ok) throw new Error(`Cardmarket a répondu ${response.status} pour ${this.urlOf(file)}`);
  }
}
