/**
 * Server configuration. Read lazily so tests and the UI can observe changes and
 * so an unconfigured deployment still renders instead of crashing at import time.
 *
 * Never expose any of these values to the client. Only `publicPuterModel` is
 * safe to share, and it is not a secret.
 */

export const DEFAULT_MCP_URL = "https://missingmcp.com/garmin/mcp";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_PUTER_MODEL = "gpt-5.4-nano";

export type AppConfig = {
  groqApiKey: string;
  groqModel: string;
  appUrl: string | null;
  sessionSecret: string;
  mcpUrl: string;
  puterModel: string;
};

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function getConfig(): AppConfig {
  return {
    groqApiKey: clean(process.env.GROQ_API_KEY),
    groqModel: clean(process.env.GROQ_MODEL) || DEFAULT_GROQ_MODEL,
    appUrl: clean(process.env.APP_URL).replace(/\/+$/, "") || null,
    sessionSecret: clean(process.env.SESSION_SECRET),
    mcpUrl: clean(process.env.GARMIN_MCP_URL) || DEFAULT_MCP_URL,
    puterModel:
      clean(process.env.NEXT_PUBLIC_PUTER_MODEL) || DEFAULT_PUTER_MODEL,
  };
}

export function hasSessionSecret(config = getConfig()): boolean {
  return config.sessionSecret.length >= 32;
}

export function hasGroqKey(config = getConfig()): boolean {
  return config.groqApiKey.length > 0;
}

/**
 * Public, non-secret flags rendered into the setup notice so a deployment can
 * explain exactly what is missing without ever echoing a secret.
 */
export function getSetupState() {
  const config = getConfig();
  return {
    sessionConfigured: hasSessionSecret(config),
    groqConfigured: hasGroqKey(config),
    mcpHost: safeHost(config.mcpUrl),
    puterModel: config.puterModel,
  };
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
}

/**
 * Validate the configured MCP URL: HTTPS only (localhost HTTP is allowed for
 * development), no credentials in the URL, no custom ports outside localhost.
 */
export function assertSafeMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("GARMIN_MCP_URL is not a valid URL.");
  }
  const localhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw new Error("GARMIN_MCP_URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("GARMIN_MCP_URL must not contain credentials.");
  }
  return url;
}
