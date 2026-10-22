import { describe, expect, it, vi } from "vitest";
import { discoverOAuth, exchangeCode, registerClient } from "@/lib/oauth";
import {
  parseAuthServerMetadata,
  parseResourceMetadata,
  OAuthError,
} from "@/lib/oauth-core";

const MCP_URL = "https://missingmcp.com/garmin/mcp";
const RESOURCE_URL =
  "https://missingmcp.com/.well-known/oauth-protected-resource/garmin/mcp";
const AUTH_URL =
  "https://missingmcp.com/.well-known/oauth-authorization-server/garmin";

const resourceDoc = {
  resource: MCP_URL,
  authorization_servers: ["https://missingmcp.com/garmin"],
};

const authDoc = {
  issuer: "https://missingmcp.com/garmin",
  authorization_endpoint: "https://missingmcp.com/garmin/oauth/authorize",
  token_endpoint: "https://missingmcp.com/garmin/oauth/token",
  registration_endpoint: "https://missingmcp.com/garmin/oauth/register",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("discoverOAuth", () => {
  it("discovers MissingMCP from the resource URL and validates endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === RESOURCE_URL) return json(resourceDoc);
      if (url === AUTH_URL) return json(authDoc);
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await discoverOAuth(MCP_URL, fetchImpl);
    expect(result.authServer.token_endpoint).toBe(
      "https://missingmcp.com/garmin/oauth/token",
    );
    expect(result.resource.resource).toBe(MCP_URL);
    expect(result.allowedOrigins).toEqual(["https://missingmcp.com"]);
    expect(calls[0]).toBe(RESOURCE_URL);
    expect(calls).toContain(AUTH_URL);
  });

  it("reports a clear blocker when dynamic registration is not advertised", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === RESOURCE_URL) return json(resourceDoc);
      if (url === AUTH_URL) {
        const { registration_endpoint: _omit, ...withoutRegistration } = authDoc;
        return json(withoutRegistration);
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(discoverOAuth(MCP_URL, fetchImpl)).rejects.toMatchObject({
      code: "registration_unsupported",
    });
  });

  it("fails clearly when metadata is unreachable", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(discoverOAuth(MCP_URL, fetchImpl)).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("registerClient", () => {
  it("registers the exact callback with client_secret_post", async () => {
    const metadata = parseAuthServerMetadata(authDoc, new URL(authDoc.issuer), new URL(MCP_URL));
    let captured: { url: string; body: Record<string, unknown> } | null = null;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return json({
        client_id: "client-abc",
        client_secret: "secret-abc",
        redirect_uris: ["https://app.example/api/auth/garmin/callback"],
        token_endpoint_auth_method: "client_secret_post",
      });
    }) as unknown as typeof fetch;

    const client = await registerClient(
      metadata,
      "https://app.example/api/auth/garmin/callback",
      fetchImpl,
    );

    expect(client.clientId).toBe("client-abc");
    expect(client.clientSecret).toBe("secret-abc");
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("https://missingmcp.com/garmin/oauth/register");
    expect(captured!.body.redirect_uris).toEqual([
      "https://app.example/api/auth/garmin/callback",
    ]);
    expect(captured!.body.token_endpoint_auth_method).toBe("client_secret_post");
  });

  it("surfaces provider registration errors", async () => {
    const metadata = parseAuthServerMetadata(authDoc, new URL(authDoc.issuer), new URL(MCP_URL));
    const fetchImpl = vi.fn(async () =>
      json({ error: "invalid_redirect_uri", error_description: "not allowed" }, 400),
    ) as unknown as typeof fetch;

    await expect(
      registerClient(metadata, "https://app.example/cb", fetchImpl),
    ).rejects.toThrow(/invalid_redirect_uri/);
  });
});

describe("exchangeCode", () => {
  it("posts client_secret_post and returns the token", async () => {
    const metadata = parseAuthServerMetadata(authDoc, new URL(authDoc.issuer), new URL(MCP_URL));
    let form: URLSearchParams | null = null;

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      form = new URLSearchParams(String(init?.body));
      return json({ access_token: "access-123", token_type: "Bearer", expires_in: 90 * 86400 });
    }) as unknown as typeof fetch;

    const tokens = await exchangeCode({
      metadata,
      code: "code-1",
      redirectUri: "https://app.example/cb",
      clientId: "client-abc",
      clientSecret: "secret-abc",
      codeVerifier: "verifier-abc",
      fetchImpl,
    });

    expect(tokens.accessToken).toBe("access-123");
    expect(form!.get("code_verifier")).toBe("verifier-abc");
    expect(form!.get("client_secret")).toBe("secret-abc");
    expect(form!.get("grant_type")).toBe("authorization_code");
  });

  it("rejects an invalid code without retrying", async () => {
    const metadata = parseAuthServerMetadata(authDoc, new URL(authDoc.issuer), new URL(MCP_URL));
    const fetchImpl = vi.fn(async () =>
      json({ error: "invalid_grant", error_description: "code expired" }, 400),
    ) as unknown as typeof fetch;

    await expect(
      exchangeCode({
        metadata,
        code: "bad",
        redirectUri: "https://app.example/cb",
        clientId: "client-abc",
        clientSecret: "secret-abc",
        codeVerifier: "verifier-abc",
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid_grant/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("resource metadata", () => {
  it("keeps only string scopes", () => {
    const parsed = parseResourceMetadata(
      { ...resourceDoc, scopes_supported: ["read", 1, null] },
      new URL(MCP_URL),
    );
    expect(parsed.scopes_supported).toEqual(["read"]);
  });
});
