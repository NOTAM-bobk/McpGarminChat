import { getConfig } from "@/lib/config";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message }, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function jsonOk(data: unknown): Response {
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Reject cross-site state-changing requests. Same-origin browser fetches send
 * an Origin header; comparing its host to the request host prevents a
 * third-party site from driving the authenticated tool-call / chat routes.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const requestHost = request.headers.get("host");
  if (requestHost && originHost === requestHost) return true;

  const configured = getConfig().appUrl;
  if (configured) {
    try {
      if (originHost === new URL(configured).host) return true;
    } catch {
      // Ignore an invalid APP_URL; host comparison below still applies.
    }
  }

  // Vercel forwards the deployment host; tolerate a proxy-adjusted host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  return Boolean(forwardedHost && originHost === forwardedHost);
}

export function requireSameOrigin(request: Request): void {
  if (!isSameOrigin(request)) {
    throw new HttpError(
      403,
      "cross_origin_blocked",
      "This request was blocked because it did not originate from this app.",
    );
  }
}

/**
 * The public origin used to build OAuth redirect URIs. APP_URL wins when set;
 * otherwise we fall back to the request URL, which keeps local dev working.
 */
export function getBaseUrl(request: Request): string {
  const configured = getConfig().appUrl;
  if (configured) return configured;

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    url.host = forwardedHost;
    if (!forwardedHost.includes(":")) url.port = "";
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function oauthCallbackUrl(request: Request): string {
  return `${getBaseUrl(request)}/api/auth/garmin/callback`;
}

export async function readJsonBody<T>(request: Request, maxBytes = 64_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}
