# dsh-codex

Codex split-routing plugin for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH).

It wraps `globalThis.fetch` **inside the DSH process** and routes by hostname:

- requests to hosts on the allow-list (default `chatgpt.com`, `auth.openai.com`) are tunneled through your **upstream proxy** (e.g. a local Clash mixed port) — needed where OpenAI/ChatGPT endpoints are geo-restricted;
- **every other request uses the original fetch untouched** — other model providers, package registries, anything else keep their normal network path;
- loopback is never routed.

**Zero launch-time setup**: no env vars, no launcher script, no system proxy change. Start `dsh web` any way you like; the plugin does the routing from inside.

## Install

```sh
dsh plugin --profile web add github:RailgunHamster/dsh-codex
```

(or `dsh plugin --profile web add file:/path/to/dsh-codex` from a local checkout)

Restart `dsh web` afterwards. The bundle patch mounts one host plugin row (`codex`) and ships a settings page.

## Provider route requirement: `transport: sse`

pi-ai's Codex backend prefers a **WebSocket** transport when left on `auto`, and a WebSocket does not go through `fetch`. Force the fetch-based SSE path on the `openai-codex` provider route in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      displayName: ChatGPT Codex
      transport: sse
```

The SSE endpoint is the same one the official client falls back to (zstd-compressed request bodies included), and both the OAuth token exchange (`auth.openai.com`) and model calls (`chatgpt.com/backend-api`) then obey the split routing.

## Configuration

Settings → **Codex** section in the DSH web UI:

| field | default | meaning |
| --- | --- | --- |
| 启用 | on | route allow-listed hosts through the upstream |
| 上游代理 | `http://127.0.0.1:7890` | upstream proxy used **only** for allow-listed hosts |
| 走代理的域名 | `chatgpt.com`, `auth.openai.com` | host suffixes routed upstream (subdomains match) |

Values persist in `$DSH_HOME/settings.yaml` under the `codex:` namespace and **apply immediately** — the wrapper reads the current settings on every request, no reboot needed.

## How it works

`dsh-llm-pi-ai` (pi-ai) hardcodes `https://auth.openai.com` for OAuth and talks to `https://chatgpt.com/backend-api`; both reject traffic from unsupported regions. Node's global fetch has no per-request proxy hook, and pointing `HTTP(S)_PROXY` at a VPN client sends *all* harness traffic abroad. This plugin wraps fetch in-process (the same technique `dsh-grok-adaptation` uses): allow-listed https requests get an `https.Agent` whose connections are `CONNECT` tunnels through the upstream proxy; everything else passes through unchanged. Streaming bodies (SSE) and request/response compression are handled; abort signals are honored.

## Scope

- No secrets, keys, or credentials are involved — the plugin only routes bytes.
- The plugin does not touch or configure your VPN client; the upstream address is yours to set.
- If the upstream proxy is down, allow-listed traffic fails while everything else keeps working.

## License

MIT
