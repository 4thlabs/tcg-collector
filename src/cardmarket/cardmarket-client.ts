// HTTP access to Cardmarket's public files (S3 bucket, no authentication), through ky.
import ky, { type KyInstance } from "ky";
import type { FeedFile } from "./feed-file.ts";

/** What the server tells about a file without downloading it (HEAD request). */
export interface RemoteVersion {
  /** S3 ETag: the file's MD5. Changes on every regeneration, even when the useful content is identical. */
  etag: string;
  lastModified: string;
  size: number;
}

export class CardmarketClient {
  static readonly defaultBaseUrl = "https://downloads.s3.cardmarket.com/productCatalog";
  /** The largest file (Magic price guide) is ~26 MB: generous margin for a slow connection. */
  static readonly timeoutMs = 120_000;

  private readonly baseUrl: string;
  private readonly http: KyInstance;

  constructor(
    baseUrl = CardmarketClient.defaultBaseUrl,
    attempts = 3,
    retryDelayMs = 5_000,
    timeoutMs = CardmarketClient.timeoutMs,
  ) {
    this.baseUrl = baseUrl;
    this.http = ky.create({
      timeout: timeoutMs,
      // Retry on network errors, timeouts and 5xx / 429 responses.
      retry: {
        limit: attempts - 1,
        methods: ["get", "head"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        delay: (attempt) => retryDelayMs * attempt,
        retryOnTimeout: true,
      },
    });
  }

  /** Published version of the file, or null when it does not exist (S3 answers 403 for a missing file). */
  async probe(file: FeedFile): Promise<RemoteVersion | null> {
    const response = await this.http.head(this.urlOf(file), {
      throwHttpErrors: (status) => status !== 403 && status !== 404,
    });

    if (!response.ok) {
      return null;
    }

    return {
      etag: response.headers.get("etag") ?? "",
      lastModified: response.headers.get("last-modified") ?? "",
      size: Number(response.headers.get("content-length") ?? 0),
    };
  }

  /** Raw file content, as published. Fails with a TimeoutError when the transfer stalls. */
  async download(file: FeedFile): Promise<Buffer> {
    const request = this.http.get(this.urlOf(file));
    // ky's own arrayBuffer() keeps the timeout running while the body downloads.
    // Reading the body from an awaited Response would wait forever on a stalled transfer.
    const bytes = await request.arrayBuffer();

    return Buffer.from(bytes);
  }

  private urlOf(file: FeedFile): string {
    return `${this.baseUrl}/${file.remotePath}`;
  }
}
