// dsh-codex — client half: the "Codex" settings section.
//
// Loaded in the browser via the client module loader. Registers one page in
// the DSH settings dialog (settings.section slot) that reads and edits the
// `codex` settings namespace through the remote settings api; every commit
// hot-applies on the host (the proxy listener restarts).

window.__ModuleLoader__.load({
	id: "dsh-codex",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;
		const useState = react.useState;
		const useEffect = react.useEffect;

		const NS = "codex";
		const FIELDS = ["enabled", "listenHost", "listenPort", "upstream", "hosts"];
		const DEFAULTS = {
			enabled: true,
			listenHost: "127.0.0.1",
			listenPort: 17890,
			upstream: "http://127.0.0.1:7890",
			hosts: ["chatgpt.com", "auth.openai.com"],
		};

		function unwrap(rpc) {
			const result = rpc && rpc.result;
			if (result && typeof result === "object" && "ok" in result) {
				if (!result.ok) throw new Error((result.error && result.error.message) || "settings call failed");
				return result.value;
			}
			return rpc;
		}

		async function readDescriptor(api) {
			const data = unwrap(await api.settings.describe({ redactSecrets: true }));
			const all = (data && (data.namespaces || data)) || {};
			const entry = all[NS];
			if (!entry) return { resolved: { ...DEFAULTS }, user: {}, revision: undefined };
			return entry;
		}

		const styles = {
			page: { display: "flex", flexDirection: "column", gap: "18px", maxWidth: "620px", padding: "4px 2px" },
			title: { margin: 0, fontSize: "18px", fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
			desc: { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary, #888)" },
			row: { display: "flex", flexDirection: "column", gap: "6px" },
			label: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-primary, inherit)" },
			hint: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary, #888)" },
			input: {
				boxSizing: "border-box", width: "100%", padding: "7px 10px", font: "inherit", fontSize: "13px",
				color: "var(--dsw-alias-label-primary, inherit)",
				background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))",
				border: "1px solid rgba(127,127,127,.28)", borderRadius: "8px", outline: "none",
			},
			checkbox: { width: "16px", height: "16px", accentColor: "var(--dsw-alias-accent-primary, #4c6ef5)" },
			footer: { display: "flex", alignItems: "center", gap: "10px" },
			primary: {
				padding: "7px 16px", font: "inherit", fontSize: "13px", fontWeight: 500, cursor: "pointer",
				color: "#fff", background: "var(--dsw-alias-accent-primary, #4c6ef5)",
				border: "none", borderRadius: "8px",
			},
			ghost: {
				padding: "7px 14px", font: "inherit", fontSize: "13px", cursor: "pointer",
				color: "var(--dsw-alias-label-primary, inherit)", background: "transparent",
				border: "1px solid rgba(127,127,127,.35)", borderRadius: "8px",
			},
			status: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #888)" },
			error: { fontSize: "12px", color: "#e03131" },
		};

		function makeSection(getConnection) {
			function CodexSection(_props) {
				const [meta, setMeta] = useState({ loading: true, error: "", saved: false, revision: undefined });
				const [draft, setDraft] = useState({
					enabled: DEFAULTS.enabled,
					listenHost: DEFAULTS.listenHost,
					listenPort: String(DEFAULTS.listenPort),
					upstream: DEFAULTS.upstream,
					hostsText: DEFAULTS.hosts.join("\n"),
				});

				const field = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

				useEffect(() => {
					let alive = true;
					(async () => {
						try {
							const connection = getConnection();
							if (!connection || !connection.api) throw new Error("connection unavailable");
							const entry = await readDescriptor(connection.api);
							if (!alive) return;
							const r = entry.resolved || DEFAULTS;
							setDraft({
								enabled: !!r.enabled,
								listenHost: String(r.listenHost ?? DEFAULTS.listenHost),
								listenPort: String(r.listenPort ?? DEFAULTS.listenPort),
								upstream: String(r.upstream ?? DEFAULTS.upstream),
								hostsText: Array.isArray(r.hosts) ? r.hosts.join("\n") : DEFAULTS.hosts.join("\n"),
							});
							setMeta({ loading: false, error: "", saved: false, revision: entry.revision });
						} catch (error) {
							if (alive) setMeta({ loading: false, error: String((error && error.message) || error), saved: false, revision: undefined });
						}
					})();
					return () => { alive = false; };
				}, []);

				const save = async () => {
					const connection = getConnection();
					if (!connection || !connection.api) return;
					const port = Number(draft.listenPort);
					if (!Number.isInteger(port) || port <= 0 || port > 65535) {
						setMeta((m) => ({ ...m, error: "监听端口必须是 1-65535 的整数", saved: false }));
						return;
					}
					const hosts = draft.hostsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
					if (hosts.length === 0) {
						setMeta((m) => ({ ...m, error: "至少需要一个域名后缀", saved: false }));
						return;
					}
					const value = {
						enabled: !!draft.enabled,
						listenHost: draft.listenHost.trim() || DEFAULTS.listenHost,
						listenPort: port,
						upstream: draft.upstream.trim() || DEFAULTS.upstream,
						hosts,
					};
					const ops = FIELDS.map((key) => ({ op: "set", path: [key], value: value[key] }));
					setMeta((m) => ({ ...m, error: "", saved: false }));
					try {
						const request = { ns: NS, ops };
						if (meta.revision !== undefined) request.expectedRevision = meta.revision;
						const response = await connection.api.settings.mutate(request);
						unwrap(response);
						const entry = await readDescriptor(connection.api);
						setMeta({ loading: false, error: "", saved: true, revision: entry.revision });
					} catch (error) {
						setMeta((m) => ({ ...m, error: String((error && error.message) || error), saved: false }));
					}
				};

				const resetDefaults = async () => {
					const connection = getConnection();
					if (!connection || !connection.api) return;
					setMeta((m) => ({ ...m, error: "", saved: false }));
					try {
						const ops = FIELDS.map((key) => ({ op: "unset", path: [key] }));
						const response = await connection.api.settings.mutate({ ns: NS, ops });
						unwrap(response);
						const entry = await readDescriptor(connection.api);
						const r = entry.resolved || DEFAULTS;
						setDraft({
							enabled: !!r.enabled,
							listenHost: String(r.listenHost ?? DEFAULTS.listenHost),
							listenPort: String(r.listenPort ?? DEFAULTS.listenPort),
							upstream: String(r.upstream ?? DEFAULTS.upstream),
							hostsText: Array.isArray(r.hosts) ? r.hosts.join("\n") : DEFAULTS.hosts.join("\n"),
						});
						setMeta({ loading: false, error: "", saved: true, revision: entry.revision });
					} catch (error) {
						setMeta((m) => ({ ...m, error: String((error && error.message) || error), saved: false }));
					}
				};

				if (meta.loading) {
					return h("div", { style: styles.page }, h("p", { style: styles.desc }, "加载中…"));
				}

				return h("div", { style: styles.page },
					h("h2", { style: styles.title }, "Codex 分流代理"),
					h("p", { style: styles.desc },
						"只有下方列出的域名经上游代理转发，其余目标一律直连。启动 DSH 时需设置 NODE_USE_ENV_PROXY=1 并把 HTTP(S)_PROXY 指向本监听地址。修改保存后立即热生效，无需重启。"),
					h("label", { style: { ...styles.row, flexDirection: "row", alignItems: "center", gap: "8px" } },
						h("input", {
							type: "checkbox", style: styles.checkbox, checked: !!draft.enabled,
							onChange: (e) => field("enabled", e.target.checked),
						}),
						h("span", { style: styles.label }, "启用分流代理监听"),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "监听地址"),
						h("input", {
							style: styles.input, value: draft.listenHost,
							onChange: (e) => field("listenHost", e.target.value),
							spellCheck: false,
						}),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "监听端口"),
						h("input", {
							style: styles.input, value: draft.listenPort, inputMode: "numeric",
							onChange: (e) => field("listenPort", e.target.value.replace(/[^\d]/g, "")),
							spellCheck: false,
						}),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "上游代理"),
						h("input", {
							style: styles.input, value: draft.upstream,
							onChange: (e) => field("upstream", e.target.value),
							spellCheck: false, placeholder: "http://127.0.0.1:7890",
						}),
						h("span", { style: styles.hint }, "仅用于上方域名的本地代理客户端地址（支持 Clash 混合端口等）。"),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "走代理的域名"),
						h("textarea", {
							style: { ...styles.input, minHeight: "76px", resize: "vertical", lineHeight: "20px" },
							value: draft.hostsText,
							onChange: (e) => field("hostsText", e.target.value),
							spellCheck: false,
						}),
						h("span", { style: styles.hint }, "每行一个域名后缀，子域自动匹配；回环地址永不走代理。"),
					),
					h("div", { style: styles.footer },
						h("button", { style: styles.primary, onClick: save }, "保存"),
						h("button", { style: styles.ghost, onClick: resetDefaults }, "恢复默认"),
						meta.error ? h("span", { style: styles.error }, meta.error)
							: meta.saved ? h("span", { style: styles.status }, "已保存，热生效 ✓")
								: h("span", { style: styles.status }, ""),
					),
				);
			}
			return CodexSection;
		}

		function apply(ctx) {
			const getConnection = () => ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "codex",
				order: 80,
				label: "Codex",
			}, makeSection(getConnection)));
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
