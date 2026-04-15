/**
 * Cloud-aware fetch wrapper.
 *
 * In Electron (desktop), this is just a regular `fetch()` — no CORS issues.
 * In kiosk mode (browser via local IP), cross-origin requests to qflo.net
 * are blocked by the browser. The kiosk bridge defines `window.qf.cloudFetch`
 * which rewrites the URL to go through the local kiosk server's proxy endpoint.
 *
 * Usage: replace `fetch('https://qflo.net/api/...')` with `cloudFetch('https://qflo.net/api/...')`.
 */
export function cloudFetch(url: string, opts?: RequestInit): Promise<Response> {
  const w = window as any;
  if (w.qf?.cloudFetch) {
    return w.qf.cloudFetch(url, opts);
  }
  return fetch(url, opts);
}
