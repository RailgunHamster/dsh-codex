# dsh-codex

Codex split-routing proxy plugin for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH).

It runs a tiny local HTTP forward proxy **inside the DSH process** and routes by hostname:

- hosts on the allow-list (default `chatgpt.com`, `auth.openai.com`) are chained to your **upstream proxy** (e.g. a local Clash mixed port) — needed where OpenAI/ChatGPT endpoints are geo-restricted;
- **every other destination connects directly** — other model providers, package registries, anything else keep their normal network path;
- loopback is never proxied.

Point Node's global fetch at it once at launch and the whole harness (model calls, OAuth token exchange, token refresh) obeys the split without touching your system proxy.

## Install

```sh
dsh plugin --profile web add github:RailgunHamster/dsh-codex
```

(or `dsh plugin --profile web add file:/path/to/dsh-codex` from a local checkout)

Restart `dsh web` afterwards. The bundle patch mounts one host plugin row (`codex`) and ships a settings page.

## Launch environment

Node 24+ built-in env-proxy support makes global fetch honor proxy variables. Start DSH with:

```sh
NODE_USE_ENV_PROXY=1 \
HTTP_PROXY=http://127.0.0.1:17890 \
HTTPS_PROXY=http://127.0.0.1:17890 \
NO_PROXY=localhost,127.0.0.1,::1 \
dsh web
```

Notes:

- `17890` is the plugin's default listen port — it must match the **监听端口** field in the settings page.
- Keep loopback in `NO_PROXY`: the browser GUI websocket and the OAuth callback listener (`localhost:1455`) must not transit any proxy.
- Adding your domestic/low-latency providers to `NO_PROXY` skips the local forwarder entirely for them (optional — everything not on the allow-list is forwarded direct anyway).

## Configuration

Settings → **Codex** section in the DSH web UI:

| field | default | meaning |
| --- | --- | --- |
| 启用 | on | run the listener |
| 监听地址 / 监听端口 | `127.0.0.1:17890` | where the forward proxy listens |
| 上游代理 | `http://127.0.0.1:7890` | upstream proxy used **only** for allow-listed hosts |
| 走代理的域名 | `chatgpt.com`, `auth.openai.com` | host suffixes routed upstream (subdomains match) |

Values persist in `$DSH_HOME/settings.yaml` under the `codex:` namespace and **hot-apply** — the listener restarts on every save, no reboot needed.

## Why a per-host forwarder?

The OpenAI Codex provider in `dsh-llm-pi-ai` (pi-ai) hardcodes `https://auth.openai.com` for OAuth and talks to `https://chatgpt.com/backend-api`; both reject traffic from unsupported regions. Node's global fetch has no per-request proxy hook, and pointing `HTTP(S)_PROXY` straight at a VPN client sends *all* harness traffic abroad. This plugin is the middle layer: a proxy whose only job is to say "these two hostnames go upstream, everything else goes direct".

## Scope

- No secrets, keys, or credentials are involved — the plugin only forwards bytes.
- The plugin does not touch or configure your VPN client; the upstream address is yours to set.
- If the upstream proxy is down, allow-listed traffic fails while everything else keeps working.

## License

MIT
