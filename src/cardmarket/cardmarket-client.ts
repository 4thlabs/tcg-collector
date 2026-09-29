// Accès HTTP aux fichiers publics de Cardmarket (bucket S3, sans authentification), via ky.
import ky, { type KyInstance } from "ky";
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
  private readonly http: KyInstance;

  constructor(baseUrl = CardmarketClient.defaultBaseUrl, attempts = 3, retryDelayMs = 5_000) {
    this.baseUrl = baseUrl;
    this.http = ky.create({
      // Le plus gros fichier (Price Guide Magic) pèse ~26 Mo : large marge pour une connexion lente.
      timeout: 120_000,
      // Nouvelles tentatives sur les erreurs réseau, les délais dépassés et les réponses 5xx / 429.
      retry: {
        limit: attempts - 1,
        methods: ["get", "head"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        delay: (attempt) => retryDelayMs * attempt,
        retryOnTimeout: true,
      },
    });
  }

  /** Version publiée du fichier, ou null s'il n'existe pas (S3 répond 403 pour un fichier absent). */
  async probe(file: FeedFile): Promise<RemoteVersion | null> {
    const response = await this.http.head(this.urlOf(file), {
      throwHttpErrors: (status) => status !== 403 && status !== 404,
    });
    if (!response.ok) return null;
    return {
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
      size: Number(response.headers.get("content-length") ?? 0),
    };
  }

  /** Contenu brut du fichier, tel que publié. */
  async download(file: FeedFile): Promise<Buffer> {
    return Buffer.from(await this.http.get(this.urlOf(file)).arrayBuffer());
  }

  private urlOf(file: FeedFile): string {
    return `${this.baseUrl}/${file.remotePath}`;
  }
}
