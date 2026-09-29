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

Restart `dsh web` afterwards. The bundle patch mounts one host plugin row (`codex`); its settings appear in the DSH settings UI.

Requires DSH 0.1.7-rc.1 or later (declared as a `@deepseek-ai/dsh` peer). On DSH 0.1.5 use dsh-codex 0.3.0; see [docs/compatibility-0.2.0.md](docs/compatibility-0.2.0.md).

## Provider route requirement: `transport: sse`

pi-ai's Codex backend prefers a **WebSocket** transport when left on `auto`, and a WebSocket does not go through `fetch`. Force the fetch-based SSE path on the `openai-codex` provider route in the profile patch `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: llm-pi-ai
  config:
    providers:
      openai-codex:
        displayName: ChatGPT Codex
        transport: sse
```

DSH 0.1.7+ imports an existing `$DSH_HOME/settings.yaml` `llm-pi-ai:` section into that entry once on first boot; before 0.1.7 the same `providers` block lived in `settings.yaml`.

The SSE endpoint is the same one the official client falls back to (zstd-compressed request bodies included), and both the OAuth token exchange (`auth.openai.com`) and model calls (`chatgpt.com/backend-api`) then obey the split routing.

## Configuration

The `codex` entry is listed in the DSH settings UI (generic plugin settings form):

| field | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | route allow-listed hosts through the upstream |
| `upstream` | `http://127.0.0.1:7890` | upstream proxy used **only** for allow-listed hosts |
| `hosts` | `chatgpt.com`, `auth.openai.com` | host suffixes routed upstream (subdomains match) |

The whole Config is volatile: edits are written to the profile's `cordis.patch.yml` `codex` entry and **apply immediately** — DSH updates the config reference in place and the wrapper reads it on every request, no reboot needed. Editing the same entry by hand works too:

```yaml
- id: codex
  config:
    upstream: http://127.0.0.1:7897
```

## How it works

`dsh-llm-pi-ai` (pi-ai) hardcodes `https://auth.openai.com` for OAuth and talks to `https://chatgpt.com/backend-api`; both reject traffic from unsupported regions. Node's global fetch has no per-request proxy hook, and pointing `HTTP(S)_PROXY` at a VPN client sends *all* harness traffic abroad. This plugin wraps fetch in-process (the same technique `dsh-grok-adaptation` uses): allow-listed https requests get an `https.Agent` whose connections are `CONNECT` tunnels through the upstream proxy; everything else passes through unchanged. Streaming bodies (SSE) and request/response compression are handled; abort signals are honored.

## Scope

- No secrets, keys, or credentials are involved — the plugin only routes bytes.
- The plugin does not touch or configure your VPN client; the upstream address is yours to set.
- If the upstream proxy is down, allow-listed traffic fails while everything else keeps working.

## License

MIT
