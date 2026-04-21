import {
  BtcIdrQuote,
  DepositRails,
  OfframpCreateInput,
  OfframpCreateResponse,
  OfframpOrder,
  PayoutMethod,
  PayoutMethodsResponse,
  PaysatsApiError,
  PaysatsClientOptions,
  PlatformStats,
  WaitForOrderOptions,
  isTerminalState,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.paysats.io";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export class PaysatsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PaysatsClientOptions) {
    if (!opts.apiKey || !opts.apiKey.trim()) {
      throw new Error("PaysatsClient: `apiKey` is required");
    }
    this.apiKey = opts.apiKey.trim();
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maybeFetch = opts.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!maybeFetch) {
      throw new Error(
        "PaysatsClient: no global `fetch` available. Pass `fetch: nodeFetch` or upgrade to Node 18+.",
      );
    }
    this.fetchImpl = maybeFetch;
  }

  async getBtcIdrQuote(): Promise<BtcIdrQuote> {
    return this.request<BtcIdrQuote>("GET", "/v1/quote/btc-idr");
  }

  async listPayoutMethods(): Promise<PayoutMethod[]> {
    const resp = await this.request<PayoutMethodsResponse>("GET", "/v1/payout/methods");
    return resp.data ?? [];
  }

  async getDepositRails(): Promise<DepositRails> {
    return this.request<DepositRails>("GET", "/v1/deposit/rails");
  }

  async getPlatformStats(): Promise<PlatformStats> {
    return this.request<PlatformStats>("GET", "/v1/platform/stats");
  }

  async createOfframpOrder(input: OfframpCreateInput): Promise<OfframpCreateResponse> {
    if (!input.idrxBankCode || !input.idrxBankName) {
      throw new Error("createOfframpOrder: idrxBankCode and idrxBankName are required");
    }
    if (!input.recipientDetails) {
      throw new Error("createOfframpOrder: recipientDetails is required");
    }
    if ((input.satAmount ?? 0) <= 0 && (input.idrAmount ?? 0) <= 0) {
      throw new Error("createOfframpOrder: satAmount or idrAmount must be positive");
    }
    return this.request<OfframpCreateResponse>("POST", "/v1/offramp/orders", input);
  }

  async getOrder(orderId: string): Promise<OfframpOrder> {
    if (!orderId) throw new Error("getOrder: orderId is required");
    return this.request<OfframpOrder>(
      "GET",
      `/v1/offramp/orders/${encodeURIComponent(orderId)}`,
    );
  }

  async listOrders(opts: { limit?: number } = {}): Promise<OfframpOrder[]> {
    const limit = opts.limit ?? 50;
    const resp = await this.request<{ orders: OfframpOrder[] }>(
      "GET",
      `/v1/offramp/orders?limit=${limit}`,
    );
    return resp.orders ?? [];
  }

  /**
   * Polls `getOrder` until the order reaches a terminal state (COMPLETED or FAILED)
   * or the timeout elapses.
   */
  async waitForOrder(
    orderId: string,
    options: WaitForOrderOptions = {},
  ): Promise<OfframpOrder> {
    const pollMs = Math.max(500, options.pollMs ?? DEFAULT_POLL_MS);
    const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    const started = Date.now();

    let lastState = "";
    while (true) {
      if (options.signal?.aborted) {
        const err = new Error("waitForOrder aborted");
        err.name = "AbortError";
        throw err;
      }

      const order = await this.getOrder(orderId);
      if (order.state !== lastState) {
        lastState = order.state;
        options.onUpdate?.(order);
      } else {
        options.onUpdate?.(order);
      }

      if (isTerminalState(order.state)) return order;

      if (Date.now() - started > timeoutMs) {
        throw new PaysatsApiError(
          `waitForOrder timed out after ${timeoutMs}ms in state ${order.state}`,
          408,
          order,
        );
      }

      await delay(pollMs, options.signal);
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          "x-api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "@paysats/sdk",
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (!res.ok) {
        const msg =
          (parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : null) || `paysats ${method} ${path} failed: HTTP ${res.status}`;
        throw new PaysatsApiError(msg, res.status, parsed);
      }

      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("delay aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      const err = new Error("delay aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
