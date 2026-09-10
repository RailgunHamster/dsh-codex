# DSH 0.1.5 compatibility

Version 0.3.0 changes the settings client to the DSH `remote.settings` service. `describe()` returns a direct result containing a namespace array; each row exposes `value` and its own revision. `mutate(namespace, operations, expectedRevision)` uses positional arguments. Saving and resetting both send the revision, failed requests are displayed, and missing or read-only settings cannot overwrite saved values with defaults. The host's fetch routing is unchanged.

Verified on Windows with the official DSH CLI 0.1.5-rc.1 on 2026-09-11. Three regression tests cover reading the current wire format, guarded save/reset, missing/read-only sections, and rejected writes. An isolated full DSH Web profile loaded all four custom plugins; the Codex page read configuration, saved a test proxy address, then read it back. The changed value was present in the isolated settings file. The real user's settings, credentials, bundles and unrelated dependency specifications were preserved. No live ChatGPT request was required for this UI compatibility repair.

Local installation uses `%USERPROFILE%\.dsh\plugins\packages\dsh-codex-0.3.0.tgz`:

```powershell
dsh plugin --profile web add "$env:USERPROFILE\.dsh\plugins\packages\dsh-codex-0.3.0.tgz"
```

This is a local build, not a published GitHub release. `npm run check` validates both shipped JavaScript files; `npm test` runs the browser contract tests. Bump the version when repacking modified source and compare installed bytes to the repository. Restart an already-running DSH Web process after a plugin update.
