import {
  authServerMetadataUrls,
  buildTokenRequestBody,
  OAuthError,
  parseAuthServerMetadata,
  parseClientRegistration,
  parseOAuthErrorPayload,
  parseResourceMetadata,
  parseTokenResponse,
  resourceMetadataUrls,
  type AuthServerMetadata,
  type ClientRegistration,
  type DiscoveryResult,
  type ResourceMetadata,
  type TokenSet,
} from "@/lib/oauth-core";

export type FetchLike = typeof fetch;

const NETWORK_TIMEOUT_MS = 10_000;
const MAX_DOCUMENT_BYTES = 200_000;

async function readBounded(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length > MAX_DOCUMENT_BYTES) {
    throw new OAuthError("response_too_large", "The authorization server response was too large.");
  }
  return text;
}

function parseJsonDocument(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OAuthError("invalid_response", `${label} was not valid JSON.`);
  }
}

async function fetchDocument(url: URL, fetchImpl: FetchLike): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    // Drain the body so the connection can be reused.
    await response.text().catch(() => "");
    return { ok: false, status: response.status, json: null };
  }
  const text = await readBounded(response);
  return { ok: true, status: response.status, json: parseJsonDocument(text, "OAuth metadata") };
}

/**
 * Discover the authorization server from the MCP resource URL using
 * RFC 9728 / RFC 8414 metadata, exactly as the MCP authorization spec requires.
 */
export async function discoverOAuth(
  mcpUrlString: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<DiscoveryResult> {
  let mcpUrl: URL;
  try {
    mcpUrl = new URL(mcpUrlString);
  } catch {
    throw new OAuthError("invalid_configuration", "GARMIN_MCP_URL is not a valid URL.");
  }

  let resource: ResourceMetadata | null = null;
  const resourceErrors: string[] = [];

  for (const url of resourceMetadataUrls(mcpUrl)) {
    try {
      const result = await fetchDocument(url, fetchImpl);
      if (!result.ok) {
        resourceErrors.push(`${url.pathname}: HTTP ${result.status}`);
        continue;
      }
      resource = parseResourceMetadata(result.json, mcpUrl);
      break;
    } catch (error) {
      resourceErrors.push(`${url.pathname}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  if (!resource) {
    throw new OAuthError(
      "discovery_failed",
      `Could not load MissingMCP protected-resource metadata (${resourceErrors.join("; ") || "no response"}).`,
    );
  }

  const failures: string[] = [];
  for (const server of resource.authorization_servers) {
    const issuer = new URL(server);
    for (const url of authServerMetadataUrls(issuer)) {
      try {
        const result = await fetchDocument(url, fetchImpl);
        if (!result.ok) {
          failures.push(`${url.pathname}: HTTP ${result.status}`);
          continue;
        }
        const authServer: AuthServerMetadata = parseAuthServerMetadata(result.json, issuer, mcpUrl);
        if (!authServer.registration_endpoint) {
          throw new OAuthError(
            "registration_unsupported",
            "MissingMCP's authorization server does not advertise dynamic client registration, so this app cannot register a client. A client must be registered by the provider and supplied via configuration.",
          );
        }
        return {
          resource,
          authServer,
          allowedOrigins: [...new Set([mcpUrl.origin, new URL(authServer.issuer).origin])],
        };
      } catch (error) {
        if (error instanceof OAuthError && error.code === "registration_unsupported") throw error;
        failures.push(`${url.pathname}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
  }

  throw new OAuthError(
    "discovery_failed",
    `Could not load MissingMCP authorization-server metadata (${failures.join("; ") || "no response"}).`,
  );
}

/**
 * Register a client for this deployment's exact callback URL. MissingMCP
 * supports open dynamic registration, so no operator approval step is needed.
 */
export async function registerClient(
  metadata: AuthServerMetadata,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<ClientRegistration> {
  if (!metadata.registration_endpoint) {
    throw new OAuthError(
      "registration_unsupported",
      "The authorization server does not support dynamic client registration.",
    );
  }

  const body: Record<string, unknown> = {
    client_name: "Garmin Chat",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };
  const supported = metadata.token_endpoint_auth_methods_supported ?? [];
  if (supported.length === 0 || supported.includes("client_secret_post")) {
    body.token_endpoint_auth_method = "client_secret_post";
  }

  let response: Response;
  try {
    response = await fetchImpl(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new OAuthError("registration_failed", "Could not reach the provider's registration endpoint.");
  }

  const text = await readBounded(response);
  const json = text ? parseJsonDocument(text, "Client registration response") : null;

  if (!response.ok) {
    const { code, description } = parseOAuthErrorPayload(json);
    throw new OAuthError(
      "registration_failed",
      `Client registration failed (HTTP ${response.status}, ${code}): ${description}`,
    );
  }
  return parseClientRegistration(json);
}

export async function exchangeCode(input: {
  metadata: AuthServerMetadata;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string | null;
  codeVerifier: string;
  fetchImpl?: FetchLike;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = buildTokenRequestBody({
    code: input.code,
    redirectUri: input.redirectUri,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    codeVerifier: input.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetchImpl(input.metadata.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new OAuthError("token_exchange_failed", "Could not reach the provider's token endpoint.");
  }

  const text = await readBounded(response);
  const json = text ? parseJsonDocument(text, "Token response") : null;

  if (!response.ok) {
    const { code, description } = parseOAuthErrorPayload(json);
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? ` Try again in ${retryAfter} seconds.` : "";
    throw new OAuthError(
      "token_exchange_failed",
      `Token exchange failed (HTTP ${response.status}, ${code}): ${description}.${suffix}`,
    );
  }
  if (!json) {
    throw new OAuthError("token_exchange_failed", "The token endpoint returned an empty response.");
  }
  return parseTokenResponse(json);
}

/**
 * MissingMCP advertises no revocation endpoint; call this only when the
 * discovered metadata includes one. Disconnect otherwise clears our session.
 */
export async function revokeToken(
  metadata: AuthServerMetadata,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!metadata.revocation_endpoint) return false;
  try {
    const response = await fetchImpl(metadata.revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      cache: "no-store",
    });
    await response.text().catch(() => "");
    return response.ok;
  } catch {
    return false;
  }
}
