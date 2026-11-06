/**
 * Small JSON HTTP client for job-board APIs: timeouts, retries with backoff
 * on 429/5xx, Retry-After support, HTTPS-only and a response size cap.
 */

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpClient {
  getJson(url: string, options?: RequestOptions): Promise<unknown>;
  postJson(url: string, body: unknown, options?: RequestOptions): Promise<unknown>;
}

/** URLs in errors and logs drop the query string, which can carry API keys. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? "?…" : ""}`;
  } catch {
    return "<invalid url>";
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
    detail: string,
  ) {
    super(`HTTP ${status} from ${redactUrl(url)}: ${detail}`);
    this.name = "HttpError";
  }
}

interface ClientConfig {
  userAgent: string;
  retries?: number;
  defaultTimeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 10_000);
}

export function createHttpClient(config: ClientConfig): HttpClient {
  const {
    userAgent,
    retries = 2,
    defaultTimeoutMs = 30_000,
    maxResponseBytes = 40 * 1024 * 1024,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = config;

  async function request(method: "GET" | "POST", url: string, body: unknown, options: RequestOptions = {}) {
    if (!url.startsWith("https://")) throw new Error(`Refusing non-HTTPS request to ${redactUrl(url)}`);

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          signal,
          redirect: "follow",
          headers: {
            accept: "application/json",
            "user-agent": userAgent,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...options.headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        // The caller cancelled (source timeout): never retry.
        if (options.signal?.aborted) throw error;
        if (attempt >= retries) throw new Error(`Request to ${redactUrl(url)} failed: ${(error as Error).message}`);
        await sleep(retryDelayMs(attempt, null));
        continue;
      }

      if (response.url && !response.url.startsWith("https://")) {
        throw new Error(`Redirected to non-HTTPS URL from ${redactUrl(url)}`);
      }

      if (!response.ok) {
        if (RETRYABLE.has(response.status) && attempt < retries) {
          await response.body?.cancel();
          await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
          continue;
        }
        const text = await response.text().catch(() => "");
        throw new HttpError(response.status, url, text.slice(0, 200) || response.statusText);
      }

      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        await response.body?.cancel();
        throw new Error(`Response from ${redactUrl(url)} too large (${declared} bytes)`);
      }
      const text = await response.text();
      if (text.length > maxResponseBytes) throw new Error(`Response from ${redactUrl(url)} too large`);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Invalid JSON from ${redactUrl(url)}`);
      }
    }
  }

  return {
    getJson: (url, options) => request("GET", url, undefined, options),
    postJson: (url, body, options) => request("POST", url, body, options),
  };
}

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
