/**
 * Redaction helpers. Anything that might reach a log, an error message shown in
 * the UI, or a tool-activity label passes through here first.
 */

const SECRET_KEY_PATTERN =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|code[_-]?verifier|authorization|cookie|set-cookie|password|api[_-]?key)/i;

/** Mask a bearer token or any long opaque credential-looking string. */
export function redactToken(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 2)}…${value.slice(-2)} [redacted]`;
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY_PATTERN.test(key)) url.searchParams.set(key, "[redacted]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

/**
 * Remove secrets from free-form text. Used on provider/tool error messages
 * before they are streamed to the browser.
 */
export function redactText(input: string): string {
  let output = input;
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [redacted]");
  output = output.replace(
    /("?(?:access_token|refresh_token|id_token|client_secret|code_verifier|api_key)"?\s*[:=]\s*")[^"]+(")/gi,
    "$1[redacted]$2",
  );
  output = output.replace(
    /\b(access_token|refresh_token|client_secret|code_verifier)=([^&\s]+)/gi,
    "$1=[redacted]",
  );
  output = output.replace(
    /\b(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,})/g,
    "[redacted]",
  );
  return output.slice(0, 1200);
}

/** Safe error description: no stack, no headers, no tokens. */
export function toSafeErrorMessage(error: unknown, fallback = "Request failed."): string {
  if (error instanceof Error && error.message) {
    return redactText(error.message);
  }
  if (typeof error === "string" && error) {
    return redactText(error);
  }
  return fallback;
}
