# DSH 0.1.7 / 0.2.0 compatibility

DSH 0.1.7 removed the settings-namespace API that 0.3.0 was built on. `ctx.settings.register(...)` no longer exists (the `settings` service became `SettingsForms`: `configure` / `describe` / `update` / `replace` / `mutate` over profile entries), and the client `settingsScope` service is gone. On 0.1.7-rc.2 and 0.2.0-rc.2, 0.3.0 fails entry init, so the `codex` row does not activate and nothing is routed; its settings page never loads either.

Version 0.4.0 follows the new model:

- The whole `Config` is `.volatile()`. DSH lists the `codex` entry in its generic plugin settings forms, writes edits to the profile's `cordis.patch.yml` `codex` entry and commits them to the plugin's config reference without remounting. The wrapper calls `config.get()` on every request.
- No cordis service is used, so the host declares no `inject`. If a later change touches a service again, it must declare it, otherwise entry init fails as it did in 0.1.0 and 0.2.0.
- The custom client settings page (`lib/client.js`) and its tests are removed.
- `@deepseek-ai/schemastery` is raised to `^3.18.4`, the first release with `.volatile()`. Profiles often hoist 3.18.2, which lacks it.
- The `@deepseek-ai/dsh-settings` peer is replaced with `@deepseek-ai/dsh: >=0.1.7-rc.1`, so the DSH 0.1.7+ startup peer check refuses to load 0.4.0 on an older host instead of failing at runtime.

Settings stored by 0.3.0 in `$DSH_HOME/settings.yaml` under `codex:` are not imported by DSH's one-time legacy import. Restate them in the profile patch if they differ from the defaults.

Verified on Windows on 2026-09-29 with the official DSH CLI 0.2.0-rc.2 in an isolated home holding the full user Web composition (escalation-tolerance, dsh-web-search 0.4.0, dsh-grok-adaptation, dsh-view-state, dsh-agent-teams). The Web process started with no entry reported as not activated, and the browser UI loaded with a clean console. `settings/describe` listed `codex` as `applies: live` with the three fields. `settings/mutate` setting `upstream` wrote the entry into the isolated profile patch, and the next `describe` returned revision 1 with the new value. `npm test` covers allow-list routing, CONNECT tunneling, in-place reference updates and fetch restoration. No live ChatGPT request was made.
