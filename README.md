# Garmin Chat

Chat with your own Garmin activities, sleep, recovery, and training data. Garmin
access is provided by the hosted [MissingMCP Garmin MCP server](https://missingmcp.com/garmin);
answers come from **Groq** (server-side, primary) or **Puter.js** (browser, optional).

This is a complete, browser-only Next.js app. No local software, Docker, Ollama,
Supabase, or database is required for the initial version.

> Not an official Garmin product. Insights are informational, not medical advice.

## Start here — what you need to do

You do **not** need a database, OAuth client registration, Docker, or any local
software to run the hosted app. You need three values and a Garmin sign-in:

### 1. Add these environment variables

| Key | What to put there |
| --- | --- |
| `SESSION_SECRET` | Any random string of **32+ characters**. Generate with `openssl rand -base64 48`. |
| `GROQ_API_KEY` | Your Groq API key from <https://console.groq.com/keys>. Server-side only. |
| `APP_URL` | The exact public origin, e.g. `https://garmin-chat.vercel.app` or `http://localhost:3000`. No trailing slash. |

Optional: `GROQ_MODEL` (default `openai/gpt-oss-120b`), `GARMIN_MCP_URL` (already
defaults to MissingMCP), and `NEXT_PUBLIC_PUTER_MODEL` (default `gpt-5.4-nano`).

- **Locally:** copy `env.example` to `.env.local`, fill it in, then `npm install && npm run dev`.
- **Vercel:** Project → Settings → Environment Variables → add the keys for
  Production (and Preview if you use it) → redeploy.

### 2. Deploy the app

Import this GitHub repository at <https://vercel.com/new>. Vercel detects Next.js
and uses the default build; no database, Supabase, or extra service is required.
Set `APP_URL` to the final domain **before** your first real Garmin connection.

### 3. Connect Garmin once

Open the deployed site and click **Connect Garmin**. You will be sent to
MissingMCP's sign-in page; this app never asks for or stores your Garmin password.
On return, the app has already registered its exact callback URL automatically
(`${APP_URL}/api/auth/garmin/callback`), so there is nothing to paste into a
dashboard.

### 4. Check it works

Ask **“Summarize my recent workouts.”** You should see tool progress such as
“Fetching recent activities…”, then a streamed answer with a date range. Then:

- Switch to **Puter** in the header to try general chat without Garmin.
- Reconnect Garmin, use Puter again, and confirm Garmin answers still arrive.
- Click **Disconnect** to clear the app session.

### 5. Things you may still need to handle

- **Change of domain:** update `APP_URL` and reconnect Garmin; the old dynamic
  client is tied to the old callback URL.
- **Public launch:** add rate limiting at the edge/Vercel Firewall. This app has
  none by design for the database-free prototype.
- **Puter model:** if the selected model cannot call tools, use Groq or set
  `NEXT_PUBLIC_PUTER_MODEL` to a tool-capable model.
- **Live verification:** I could not run the real Garmin OAuth exchange or Groq
  requests without credentials. Complete the [verification checklist](#verification-checklist)
  before calling the deployment production-ready.

## What it does

- Real **Connect Garmin** flow: OAuth 2.1 discovery, dynamic client registration,
  Authorization Code + PKCE (S256), state validation, and a verified tool discovery
  call before the UI shows "connected".
- Tokens live only in an authenticated-encrypted, HttpOnly, Secure, SameSite=Lax
  cookie. They never reach localStorage, URLs, the client bundle, or Puter.
- Groq answers stream token-by-token and call Garmin tools through a bounded,
  server-side tool loop.
- Puter runs in the browser and selects Garmin tools through its documented
  function-calling API, but every tool executes on our server with the user's
  session. Without Garmin connected it is labeled **"General chat — Garmin tools
  unavailable."**
- Read-only by default: a curated allowlist of ~43 Garmin tools, capped to 32
  exposed to a model. Write tools are never offered.
- Polished, responsive chat UI: light/dark, mobile drawer, starter prompts,
  markdown, copy, retry, stop, tool progress, date-range provenance, and
  disconnected states.
- Unconfigured deployments render with a setup notice instead of crashing or
  showing fake connection state.

## Verified integration facts

These were checked against the providers' live endpoints and documentation while
building this app:

### MissingMCP

| Item | Value |
| --- | --- |
| MCP endpoint (Streamable HTTP) | `https://missingmcp.com/garmin/mcp` |
| Protected-resource metadata | `https://missingmcp.com/.well-known/oauth-protected-resource/garmin/mcp` |
| Authorization-server metadata | `https://missingmcp.com/.well-known/oauth-authorization-server/garmin` |
| Authorization | `https://missingmcp.com/garmin/oauth/authorize` |
| Token | `https://missingmcp.com/garmin/oauth/token` |
| Dynamic registration | `https://missingmcp.com/garmin/oauth/register` |
| PKCE | Authorization Code + S256 |
| Token auth method | `client_secret_post` |
| Scopes | None advertised |
| Refresh token | Not advertised (`grant_types_supported: ["authorization_code"]`) |
| Revocation endpoint | Not advertised |

Custom clients are supported through open dynamic client registration; no
operator approval or allow-list is involved. The app registers a new client for
each connection attempt using the **exact** callback
`${APP_URL}/api/auth/garmin/callback`, so no manual callback registration is
needed. If you later use a pre-registered client instead, register that same URL.

The provider's gateway token lifetime defaults to 90 days. This app stores
`expires_in` and asks the user to reconnect when it lapses. Because no refresh
grant or revocation endpoint is advertised, disconnect clears our session and
makes a best-effort revocation call only if a provider adds one.

Docs: <https://missingmcp.com/garmin> and <https://missingmcp.com/garmin/chatgpt>.

### Groq

- OpenAI-compatible base: `https://api.groq.com/openai/v1`
- Tool calling: standard function calling (`tools`, `tool_choice`, `tool_calls`)
- Default model: `openai/gpt-oss-120b` (configurable with `GROQ_MODEL`)
- Streaming: supported for Chat Completions

The app deliberately uses **standard tool calling plus a server-side MCP client**
instead of Groq's beta remote-MCP passthrough. That gives explicit tool discovery,
read-only allowlisting, argument validation, sanitized progress events, and keeps
the MissingMCP Bearer token on the server. The remote-MCP docs remain at
<https://console.groq.com/docs/tool-use/remote-mcp> if you want to compare.

Not every Groq model supports tool use. Pick one of Groq's tool-capable models
and set `GROQ_MODEL`. Rate limits are account- and model-specific; check your
Groq console. The app surfaces HTTP 429 without retry storms.

### Puter.js

- SDK: `https://js.puter.com/v2/`, loaded on demand only when Puter is selected
- Chat: `puter.ai.chat(messages, { model, tools, toolChoice, stream, normalize })`
- Function calling is documented (tools, `tool_calls`, tool results)
- Uses the user's Puter account and allowance/billing; free tiers can impose limits

Puter supports **function calling**, not arbitrary MCP-server attachment in the
browser. So when Garmin is connected, Puter receives sanitized tool schemas, picks
a tool, and our `/api/garmin/tool-call` route executes it with the HttpOnly
session. The Garmin access token is never given to Puter. The first model step
forces tool use; if the selected Puter model ignores the tools, the answer is
discarded and the user is told to switch to Groq rather than showing invented data.
Puter tool loops are non-streaming; general Puter chat streams.

Docs: <https://docs.puter.com/AI/chat/>.

## Architecture

```
Browser (React client)
  ├─ /                     chat UI, in-memory history, provider selector
  ├─ /api/auth/garmin/*    OAuth start, callback, disconnect
  ├─ /api/garmin/status    connection/setup state (no tokens)
  ├─ /api/garmin/tools     allowlisted tool schemas for Puter
  ├─ /api/garmin/tool-call validated server-side execution for Puter
  └─ /api/chat             Groq SSE stream + server tool loop
        │
        ├─ MissingMCP MCP (Streamable HTTP, Bearer token)
        └─ Groq Chat Completions (function calling)

Session: iron-session sealed cookie (HttpOnly, Secure, SameSite=Lax, 7 days)
```

Key modules:

- `src/lib/oauth-core.ts` – discovery URL construction, metadata validation, PKCE,
  state, token/registration parsing.
- `src/lib/oauth.ts` – discovery, registration, token exchange, optional revocation.
- `src/lib/session.ts` / `session-store.ts` – session model, expiry, size guard,
  `SessionStore` adapter (cookie implementation), config check.
- `src/lib/mcp.ts` – Streamable HTTP JSON-RPC client (JSON + SSE), timeouts,
  session cleanup, bounded output.
- `src/lib/tools.ts` – read-only allowlist, schema sanitization, argument
  validation, date provenance.
- `src/lib/groq.ts` – streaming chat loop, max 4 steps / 8 tool calls, error mapping.
- `src/lib/puter-chat.ts` – Puter function-calling loop through server tools.
- `src/lib/auth.ts` – per-request isolated authorization resolution.

### Session security

- Uses `iron-session` (vetted encryption/sealing) rather than custom crypto.
- Cookie is HttpOnly, Secure in production, SameSite=Lax (needed for the top-level
  OAuth callback), bounded to 7 days.
- The OAuth handshake (state, PKCE verifier, client credentials) is stored in the
  same sealed cookie, expires after 10 minutes, and is cleared before the token
  exchange.
- A session over 3 KB raises an explicit error instead of silently weakening
  storage. Swap in a durable store by implementing `SessionStore` in
  `src/lib/session-store.ts`.
- State-changing routes require a same-origin `Origin` header (CSRF protection).
- Tokens and tool payloads are never logged; error text is redacted.
- Each request reads only its own cookie. There is no shared token cache.

### Safety boundaries

- Only curated read-only tools are exposed; annotations marking a tool destructive
  or non-read-only also exclude it.
- Tool names are checked against the allowlist on both chat and tool-call paths.
- Arguments are validated against the discovered JSON Schema: required fields,
  allowed keys, primitive types, enum values, prototype-pollution keys, size cap.
- MCP metadata endpoints are restricted to HTTPS and the configured/issuer hosts;
  tool requests only go to `GARMIN_MCP_URL`.
- Timeouts on OAuth, MCP, and tool calls; tool output truncated at 16k chars;
  responses read with a 2 MB cap; bounded model steps and tool calls.
- Tool results are marked as untrusted data in the system prompt, so instructions
  embedded in Garmin data are not followed.
- Model output is rendered with `react-markdown` with raw HTML disabled and links
  limited to http(s).

## Run locally

Requirements: Node.js 20+ and a Groq API key, plus a Garmin account for the OAuth
flow.

```bash
npm install
cp env.example .env.local
# fill SESSION_SECRET, GROQ_API_KEY, and APP_URL
npm run dev
```

Open <http://localhost:3000>, click **Connect Garmin**, and sign in on
MissingMCP's page.

Generate a secret:

```bash
openssl rand -base64 48
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes (32+ chars) | Encrypts the session cookie |
| `APP_URL` | Yes in production | Exact OAuth callback origin |
| `GROQ_API_KEY` | For Groq | Server-side Groq key; never `NEXT_PUBLIC_` |
| `GROQ_MODEL` | Optional | Tool-capable Groq model; default `openai/gpt-oss-120b` |
| `GARMIN_MCP_URL` | Optional | Defaults to `https://missingmcp.com/garmin/mcp` |
| `NEXT_PUBLIC_PUTER_MODEL` | Optional | Public Puter model id; default `gpt-5.4-nano` |

The template ships as **`env.example`** (the workspace's secret-file guard blocks
writing a dotenv-prefixed template). Copy it to `.env.local` for local development,
or set the same keys in Vercel. It contains placeholders only.

No OAuth client credentials are required because MissingMCP supports dynamic
registration. Never put server secrets behind `NEXT_PUBLIC_`.

## Deploy to Vercel

1. Push this repository to GitHub and import it at <https://vercel.com/new>.
   Framework detection handles Next.js; no custom build command is needed.
2. Add the environment variables above for Production (and Preview if desired).
   Set `APP_URL` to the final production origin, e.g.
   `https://garmin-chat.vercel.app` (or your custom domain).
3. Deploy.
4. Open the site, click **Connect Garmin**, and complete MissingMCP's sign-in.
5. If you change `APP_URL` or the domain, reconnect Garmin: the dynamic client was
   registered for the old callback URL.

Vercel notes (checked against current docs):

- The chat route exports `maxDuration = 60` (seconds), within limits for all
  plans. Current Vercel Functions limits are 300 s default/max on Hobby and up to
  800 s standard on Pro.
- **Hobby is for non-commercial personal use only.** Commercial use requires Pro
  or Enterprise. Hobby includes 1M function invocations and 4 hours of active CPU
  per month; exceeding allowances can pause the feature until the cycle resets.
  No database does not remove these limits.
- This app has no server-side rate limiting. Before a public launch, add a
  Vercel Firewall/WAF rule or an edge rate limiter backed by durable storage.
  Provider quotas are not unlimited and are not a substitute for abuse control.

Sources: <https://vercel.com/docs/functions/configuring-functions/duration>,
<https://vercel.com/docs/plans/hobby>,
<https://vercel.com/docs/limits/fair-use-guidelines>.

## Tests and checks

```bash
npm test          # Vitest: 102 tests across 10 files
npm run typecheck # tsc --noEmit
npm run build     # next build
```

Covered:

- OAuth discovery URLs and metadata validation (wrong host, plaintext, issuer,
  PKCE support), dynamic registration payload, token exchange payload, provider
  errors, state freshness and constant-time comparison, RFC 7636 PKCE vector.
- Session expiry, cookie size guard, tampered/foreign-secret cookies, expired
  tokens, and isolation between two users' cookies.
- Read-only allowlist (write tools excluded), destructive annotations, tool caps,
  schema sanitization, argument validation, prototype pollution, date ranges.
- MCP initialize/list/call, Bearer and session headers, SSE parsing, 401/429
  mapping, output truncation.
- Groq streaming tool loop, allowlist enforcement for requested tools, malformed
  arguments, 429 handling, no-tools handling, token rejection handling.
- Puter normalization, auth/allowance/cancel errors, server-executed Garmin tools,
  discarded non-tool answers, reconnect handling, general chat without tools.
- CSRF origin checks, base URL derivation, chat request validation, secret
  redaction.
- Route-level tests through the real handlers: the OAuth callback (valid state,
  mismatched state, expired handshake, access denied, tool-count verification),
  streamed chat with a mocked Garmin tool round-trip, cross-site rejection,
  allowlisted vs. write tool execution, and session clearing on disconnect.

## Verification checklist

Automated (run and passing in this workspace):

- [x] `npm test` — 102/102
- [x] `npm run typecheck`
- [x] `npm run build`

Manual, requires credentials and a Garmin account (not exercised here):

- [ ] `SESSION_SECRET`, `GROQ_API_KEY`, `APP_URL` set
- [ ] Connect Garmin → MissingMCP sign-in → back to app with "Garmin connected"
- [ ] Ask "Summarize my recent workouts" → tool progress → answer with a date range
- [ ] Switch to Puter → general chat works while disconnected
- [ ] Connect Garmin, use Puter → Garmin tools execute server-side, no token in
      DevTools Network payloads to Puter
- [ ] Disconnect → session cleared, Groq asks to reconnect, Puter relabels
- [ ] Stop generation mid-stream; retry a failed message
- [ ] Mobile drawer, composer above the keyboard, light/dark, keyboard focus

## Known limitations

- **Live providers were not exercised in this workspace.** There was no Garmin
  account or Groq key available, so the OAuth exchange and real Garmin answers
  have not been run end-to-end here. The integration code follows the verified
  provider metadata above; complete the manual checklist before claiming it
  works in your deployment.
- **No database:** sessions are per-browser cookies and cannot be listed or
  revoked server-side. Disconnect clears the local session; MissingMCP advertises
  no revocation endpoint today. Clearing cookies or losing the device requires
  reconnecting.
- **No refresh token:** MissingMCP currently issues no refresh token. Expiry
  requires reconnecting (the default gateway lifetime is long).
- **Cookie size:** an oversized authorization fails with a clear error. A durable
  `SessionStore` adapter is the documented path if a provider's tokens grow.
- **No app-level rate limiting or abuse controls.** Groq/MissingMCP quotas and
  Vercel limits apply. Add durable rate limiting before a public launch.
- **No CSP.** Puter.js is a third-party script; a strict CSP needs explicit
  allowlisting and testing. The UI otherwise ships standard security headers.
- **Puter tool support is model-dependent.** The app forces tool use on the first
  step and refuses to show an answer that skipped Garmin tools. Puter tool loops
  are non-streaming; general Puter chat streams.
- **Tool catalog can differ.** MissingMCP's public pages list different tool counts
  (134 vs 154); this app trusts the live `tools/list` response and only exposes
  allowlisted read-only names. Some metrics may not be available for your account.
- **No write actions.** Editing activities, creating workouts, and account changes
  are intentionally unsupported.
- **Health data is not medical advice.** The app labels AI interpretation and
  refuses diagnosis-style certainty.
- Conversation history is in memory only. Reloading the tab clears it; health
  chats are never written to localStorage.
