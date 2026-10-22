import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pure OAuth 2.1 / MCP authorization helpers.
 *
 * MissingMCP advertises, live:
 *   resource metadata: https://missingmcp.com/.well-known/oauth-protected-resource/garmin/mcp
 *   auth server meta:  https://missingmcp.com/.well-known/oauth-authorization-server/garmin
 *   authorize:         https://missingmcp.com/garmin/oauth/authorize
 *   token:             https://missingmcp.com/garmin/oauth/token
 *   register:          https://missingmcp.com/garmin/oauth/register
 *
 * Nothing here is hardcoded for production use: the flow starts from the
 * configured MCP URL and discovers the rest. The constants document the
 * verified provider shape and are used in tests.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type ResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
};

export type AuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  scopes_supported?: string[];
  revocation_endpoint?: string;
};

export type DiscoveryResult = {
  resource: ResourceMetadata;
  authServer: AuthServerMetadata;
  allowedOrigins: string[];
};

export class OAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

/** PKCE verifier: 32 random bytes -> 43 base64url chars (RFC 7636 allows 43-128). */
export function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

export function codeChallengeFor(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = createCodeVerifier();
  return { verifier, challenge: codeChallengeFor(verifier) };
}

export function createState(): string {
  return base64Url(randomBytes(32));
}

/** Constant-time comparison for the OAuth state value. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isOAuthStateFresh(createdAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt <= OAUTH_STATE_TTL_MS;
}

/**
 * RFC 9728 / MCP discovery locations. MissingMCP serves the path-suffixed form;
 * the root form is a standards fallback for other providers.
 */
export function resourceMetadataUrls(mcpUrl: URL): URL[] {
  const suffix = mcpUrl.pathname.replace(/\/+$/, "");
  const prefix = `${mcpUrl.origin}/.well-known/oauth-protected-resource`;
  const urls = [`${prefix}${suffix}`, prefix].map((value) => new URL(value));
  return urls;
}

/**
 * RFC 8414 path insertion plus the OpenID Connect fallback used by some
 * authorization servers. MissingMCP only serves the path-suffixed form.
 */
export function authServerMetadataUrls(issuer: URL): URL[] {
  const suffix = issuer.pathname.replace(/\/+$/, "");
  const origin = issuer.origin;
  const urls = [
    `${origin}/.well-known/oauth-authorization-server${suffix}`,
    `${origin}/.well-known/openid-configuration${suffix}`,
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ];
  return [...new Set(urls)].map((value) => new URL(value));
}

function httpsUrl(value: unknown, label: string): URL {
  if (typeof value !== "string" || !value) {
    throw new OAuthError("invalid_metadata", `Authorization metadata is missing ${label}.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("invalid_metadata", `${label} is not a valid URL.`);
  }
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw new OAuthError("invalid_metadata", `${label} must use HTTPS.`);
  }
  return url;
}

export function parseResourceMetadata(raw: unknown, mcpUrl: URL): ResourceMetadata {
  const data = raw as Partial<ResourceMetadata> | null;
  if (!data || typeof data !== "object") {
    throw new OAuthError("invalid_metadata", "Protected resource metadata was not an object.");
  }
  if (!Array.isArray(data.authorization_servers) || data.authorization_servers.length === 0) {
    throw new OAuthError(
      "invalid_metadata",
      "Protected resource metadata did not list an authorization server.",
    );
  }
  const servers = data.authorization_servers.map((value) => httpsUrl(value, "authorization server").toString());
  if (data.resource && typeof data.resource === "string") {
    const resource = httpsUrl(data.resource, "resource");
    const normalize = (value: string) => value.replace(/\/+$/, "");
    if (normalize(resource.toString()) !== normalize(mcpUrl.toString())) {
      throw new OAuthError(
        "invalid_metadata",
        "Protected resource metadata points at a different MCP server than the configured endpoint.",
      );
    }
  }
  return {
    resource: typeof data.resource === "string" ? data.resource : mcpUrl.toString(),
    authorization_servers: [...new Set(servers)],
    scopes_supported: Array.isArray(data.scopes_supported)
      ? data.scopes_supported.filter((scope): scope is string => typeof scope === "string")
      : undefined,
  };
}

export function parseAuthServerMetadata(
  raw: unknown,
  issuer: URL,
  mcpUrl: URL,
): AuthServerMetadata {
  const data = raw as Partial<AuthServerMetadata> | null;
  if (!data || typeof data !== "object") {
    throw new OAuthError("invalid_metadata", "Authorization server metadata was not an object.");
  }
  if (typeof data.issuer !== "string" || !data.issuer) {
    throw new OAuthError("invalid_metadata", "Authorization server metadata is missing its issuer.");
  }
  const issuerUrl = httpsUrl(data.issuer, "issuer");
  if (issuerUrl.toString().replace(/\/+$/, "") !== issuer.toString().replace(/\/+$/, "")) {
    throw new OAuthError("invalid_metadata", "Authorization server issuer did not match discovery.");
  }

  const authorization = httpsUrl(data.authorization_endpoint, "authorization endpoint");
  const token = httpsUrl(data.token_endpoint, "token endpoint");
  const registration = data.registration_endpoint
    ? httpsUrl(data.registration_endpoint, "registration endpoint")
    : undefined;

  // Never talk to an unrelated host discovered from an unauthenticated document.
  const allowedHosts = new Set([issuerUrl.host, mcpUrl.host]);
  for (const [label, url] of [
    ["authorization endpoint", authorization],
    ["token endpoint", token],
    ["registration endpoint", registration],
  ] as const) {
    if (url && !allowedHosts.has(url.host)) {
      throw new OAuthError(
        "invalid_metadata",
        `The ${label} is on an unexpected host. Refusing to send credentials there.`,
      );
    }
  }

  const pkce = data.code_challenge_methods_supported;
  if (Array.isArray(pkce) && !pkce.includes("S256")) {
    throw new OAuthError("pkce_unsupported", "The provider does not support PKCE S256.");
  }

  return {
    issuer: issuerUrl.toString().replace(/\/+$/, ""),
    authorization_endpoint: authorization.toString(),
    token_endpoint: token.toString(),
    registration_endpoint: registration?.toString(),
    response_types_supported: data.response_types_supported,
    grant_types_supported: data.grant_types_supported,
    code_challenge_methods_supported: pkce,
    token_endpoint_auth_methods_supported: data.token_endpoint_auth_methods_supported,
    scopes_supported: Array.isArray(data.scopes_supported)
      ? data.scopes_supported.filter((scope): scope is string => typeof scope === "string")
      : undefined,
    revocation_endpoint: data.revocation_endpoint
      ? httpsUrl(data.revocation_endpoint, "revocation endpoint").toString()
      : undefined,
  };
}

export function buildAuthorizeUrl(input: {
  metadata: AuthServerMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  return url.toString();
}

export type ClientRegistration = {
  clientId: string;
  clientSecret: string | null;
  tokenEndpointAuthMethod: "client_secret_post" | "none";
};

export function parseClientRegistration(raw: unknown): ClientRegistration {
  const data = raw as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    throw new OAuthError("registration_failed", "Dynamic client registration returned no client.");
  }
  const clientId = typeof data.client_id === "string" ? data.client_id : "";
  if (!clientId) {
    throw new OAuthError("registration_failed", "Dynamic client registration returned no client_id.");
  }
  const clientSecret = typeof data.client_secret === "string" ? data.client_secret : "";
  const method = typeof data.token_endpoint_auth_method === "string"
    ? data.token_endpoint_auth_method
    : clientSecret
      ? "client_secret_post"
      : "none";

  // MissingMCP requires client_secret_post; support public clients only if a
  // provider explicitly declares token_endpoint_auth_method "none".
  if (method !== "client_secret_post" && method !== "none") {
    throw new OAuthError(
      "registration_failed",
      `Unsupported token endpoint authentication method: ${method}.`,
    );
  }
  if (method === "client_secret_post" && !clientSecret) {
    throw new OAuthError("registration_failed", "The provider did not return a client secret.");
  }
  return {
    clientId,
    clientSecret: clientSecret || null,
    tokenEndpointAuthMethod: method,
  };
}

export type TokenSet = {
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
  scope: string | null;
};

export function parseTokenResponse(raw: unknown): TokenSet {
  const data = raw as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    throw new OAuthError("token_exchange_failed", "The token endpoint returned no token.");
  }
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) {
    throw new OAuthError("token_exchange_failed", "The token endpoint returned no access_token.");
  }
  const tokenType = typeof data.token_type === "string" ? data.token_type : "Bearer";
  if (tokenType.toLowerCase() !== "bearer") {
    throw new OAuthError("token_exchange_failed", "The provider returned an unsupported token type.");
  }
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? Math.floor(data.expires_in)
      : null;
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

export function parseOAuthErrorPayload(raw: unknown): { code: string; description: string } {
  const data = raw as Record<string, unknown> | null;
  const code = data && typeof data.error === "string" ? data.error : "oauth_error";
  const description =
    data && typeof data.error_description === "string"
      ? data.error_description
      : "The authorization server rejected the request.";
  return { code, description: description.slice(0, 400) };
}

/**
 * Token endpoint body. MissingMCP requires client_secret_post and PKCE.
 * Public clients ("none") omit the secret but keep the verifier.
 */
export function buildTokenRequestBody(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string | null;
  codeVerifier: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  return body;
}
