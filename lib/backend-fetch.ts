/**
 * Browser fetches to ngrok free URLs hit an HTML interstitial (ERR_NGROK_6024) unless
 * this header is set. See https://ngrok.com/docs/errors/err_ngrok_6024/
 */
const NGROK_SKIP_HEADER = "ngrok-skip-browser-warning" as const;

export const BACKEND_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080"
).replace(/\/$/, "");

function isNgrokBackendUrl(): boolean {
  return /ngrok/i.test(BACKEND_URL);
}

/** Same-origin style path under BACKEND_URL, e.g. `/api/quote/btc-idr`. */
export function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  if (isNgrokBackendUrl()) {
    headers.set(NGROK_SKIP_HEADER, "true");
  }
  return fetch(url, { ...init, headers });
}
