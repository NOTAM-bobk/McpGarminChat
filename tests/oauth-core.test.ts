import { describe, expect, it } from "vitest";
import {
  authServerMetadataUrls,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  codeChallengeFor,
  createCodeVerifier,
  createPkcePair,
  createState,
  isOAuthStateFresh,
  OAUTH_STATE_TTL_MS,
  OAuthError,
  parseAuthServerMetadata,
  parseClientRegistration,
  parseResourceMetadata,
  parseTokenResponse,
  resourceMetadataUrls,
  safeEqual,
} from "@/lib/oauth-core";

const MCP = new URL("https://missingmcp.com/garmin/mcp");
const ISSUER = new URL("https://missingmcp.com/garmin");

const resourceMetadata = {
  resource: "https://missingmcp.com/garmin/mcp",
  authorization_servers: ["https://missingmcp.com/garmin"],
};

const authMetadata = {
  issuer: "https://missingmcp.com/garmin",
  authorization_endpoint: "https://missingmcp.com/garmin/oauth/authorize",
  token_endpoint: "https://missingmcp.com/garmin/oauth/token",
  registration_endpoint: "https://missingmcp.com/garmin/oauth/register",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
};

describe("PKCE", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates verifiers within the RFC length and charset", () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
    const pair = createPkcePair();
    expect(pair.challenge).toBe(codeChallengeFor(pair.verifier));
  });
});

describe("state", () => {
  it("is unpredictable and comparable in constant time", () => {
    const first = createState();
    const second = createState();
    expect(first).not.toBe(second);
    expect(safeEqual(first, first)).toBe(true);
    expect(safeEqual(first, second)).toBe(false);
    expect(safeEqual(first, `${first}x`)).toBe(false);
  });

  it("expires after ten minutes", () => {
    const now = Date.now();
    expect(isOAuthStateFresh(now, now)).toBe(true);
    expect(isOAuthStateFresh(now - OAUTH_STATE_TTL_MS + 1, now)).toBe(true);
    expect(isOAuthStateFresh(now - OAUTH_STATE_TTL_MS - 1, now)).toBe(false);
    expect(isOAuthStateFresh(Number.NaN, now)).toBe(false);
  });
});

describe("discovery URLs", () => {
  it("inserts the protected-resource path, with a root fallback", () => {
    expect(resourceMetadataUrls(MCP).map((url) => url.toString())).toEqual([
      "https://missingmcp.com/.well-known/oauth-protected-resource/garmin/mcp",
      "https://missingmcp.com/.well-known/oauth-protected-resource",
    ]);
  });

  it("builds RFC 8414 and OIDC metadata URLs", () => {
    const urls = authServerMetadataUrls(ISSUER).map((url) => url.toString());
    expect(urls[0]).toBe(
      "https://missingmcp.com/.well-known/oauth-authorization-server/garmin",
    );
    expect(urls).toContain(
      "https://missingmcp.com/.well-known/openid-configuration/garmin",
    );
  });
});

describe("metadata validation", () => {
  it("accepts the verified MissingMCP document", () => {
    const parsed = parseAuthServerMetadata(authMetadata, ISSUER, MCP);
    expect(parsed.token_endpoint).toBe("https://missingmcp.com/garmin/oauth/token");
    expect(parsed.registration_endpoint).toBe(
      "https://missingmcp.com/garmin/oauth/register",
    );
  });

  it("rejects an authorization server pointing at another host", () => {
    expect(() =>
      parseAuthServerMetadata(
        {
          ...authMetadata,
          token_endpoint: "https://attacker.example/token",
        },
        ISSUER,
        MCP,
      ),
    ).toThrow(OAuthError);
  });

  it("rejects plaintext authorization endpoints", () => {
    expect(() =>
      parseAuthServerMetadata(
        { ...authMetadata, token_endpoint: "http://missingmcp.com/token" },
        ISSUER,
        MCP,
      ),
    ).toThrow(/HTTPS/);
  });

  it("rejects a mismatched issuer", () => {
    expect(() =>
      parseAuthServerMetadata({ ...authMetadata, issuer: "https://other.example" }, ISSUER, MCP),
    ).toThrow(/issuer/i);
  });

  it("rejects a resource that is not the configured MCP server", () => {
    expect(() =>
      parseResourceMetadata(
        { ...resourceMetadata, resource: "https://other.example/mcp" },
        MCP,
      ),
    ).toThrow(/different MCP server/i);
    expect(() =>
      parseResourceMetadata(
        { ...resourceMetadata, resource: "https://missingmcp.com/other/mcp" },
        MCP,
      ),
    ).toThrow(/different MCP server/i);
  });

  it("requires at least one authorization server", () => {
    expect(() => parseResourceMetadata({ authorization_servers: [] }, MCP)).toThrow(
      OAuthError,
    );
  });

  it("refuses non-S256 PKCE metadata", () => {
    expect(() =>
      parseAuthServerMetadata(
        { ...authMetadata, code_challenge_methods_supported: ["plain"] },
        ISSUER,
        MCP,
      ),
    ).toThrow(/PKCE/i);
  });
});

describe("authorize URL", () => {
  it("includes PKCE S256, state, resource, and the exact redirect", () => {
    const url = new URL(
      buildAuthorizeUrl({
        metadata: parseAuthServerMetadata(authMetadata, ISSUER, MCP),
        clientId: "client-123",
        redirectUri: "https://garmin-chat.example/api/auth/garmin/callback",
        state: "state-abc",
        codeChallenge: "challenge-xyz",
        resource: "https://missingmcp.com/garmin/mcp",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://missingmcp.com/garmin/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://garmin-chat.example/api/auth/garmin/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe("https://missingmcp.com/garmin/mcp");
  });
});

describe("client registration", () => {
  it("requires a secret for client_secret_post", () => {
    expect(() =>
      parseClientRegistration({ client_id: "abc", token_endpoint_auth_method: "client_secret_post" }),
    ).toThrow(/client secret/i);

    const parsed = parseClientRegistration({
      client_id: "abc",
      client_secret: "shh",
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(parsed).toEqual({
      clientId: "abc",
      clientSecret: "shh",
      tokenEndpointAuthMethod: "client_secret_post",
    });
  });

  it("supports public clients only when explicitly declared", () => {
    expect(
      parseClientRegistration({ client_id: "abc", token_endpoint_auth_method: "none" }),
    ).toEqual({ clientId: "abc", clientSecret: null, tokenEndpointAuthMethod: "none" });
  });

  it("rejects unsupported auth methods", () => {
    expect(() =>
      parseClientRegistration({ client_id: "abc", token_endpoint_auth_method: "private_key_jwt" }),
    ).toThrow(/Unsupported/);
  });
});

describe("token exchange", () => {
  it("sends client_secret_post plus the PKCE verifier", () => {
    const body = buildTokenRequestBody({
      code: "code-1",
      redirectUri: "https://app.example/cb",
      clientId: "client-1",
      clientSecret: "secret-1",
      codeVerifier: "verifier-1",
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("secret-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("redirect_uri")).toBe("https://app.example/cb");
  });

  it("omits the secret for public clients", () => {
    const body = buildTokenRequestBody({
      code: "code-1",
      redirectUri: "https://app.example/cb",
      clientId: "client-1",
      clientSecret: null,
      codeVerifier: "verifier-1",
    });
    expect(body.has("client_secret")).toBe(false);
  });

  it("parses a bearer token and optional expiry", () => {
    expect(
      parseTokenResponse({ access_token: "token", token_type: "bearer", expires_in: 3600 }),
    ).toEqual({ accessToken: "token", tokenType: "Bearer", expiresIn: 3600, scope: null });
    expect(() => parseTokenResponse({})).toThrow(/access_token/);
    expect(() => parseTokenResponse({ access_token: "t", token_type: "mac" })).toThrow(
      /token type/i,
    );
  });
});
