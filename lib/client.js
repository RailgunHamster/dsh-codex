// dsh-codex — client half: the "Codex" settings section.
//
// Loaded in the browser via the client module loader. Registers one page in
// the DSH settings dialog (settings.section slot) that reads and edits the
// `codex` settings namespace through the remote settings api; every commit
// hot-applies on the host (the fetch routing configuration changes).

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
		const FIELDS = ["enabled", "upstream", "hosts"];
		const DEFAULTS = {
			enabled: true,
			upstream: "http://127.0.0.1:7890",
			hosts: ["chatgpt.com", "auth.openai.com"],
		};

		function unwrap(result) {
			if (!result || typeof result.ok !== "boolean") throw new Error("无效的设置接口响应");
			if (!result.ok) throw new Error((result.error && result.error.message) || "设置调用失败");
			return result.value;
		}

		async function readDescriptor(api) {
			if (!api?.settings) throw new Error("设置接口尚未连接，请重试");
			const data = unwrap(await api.settings.describe());
			const entry = data?.namespaces?.find((row) => row.ns === NS);
			if (!entry) throw new Error("Codex 设置未注册，请检查主机插件是否启用");
			return { ...entry, resolved: entry.value, writable: data.writable === true };
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

		function makeSection(getRemote) {
			function CodexSection(_props) {
				const [meta, setMeta] = useState({ loading: true, error: "", saved: false, revision: undefined, writable: false, busy: false });
				const [reload, setReload] = useState(0);
				const [draft, setDraft] = useState({
					enabled: DEFAULTS.enabled,
					upstream: DEFAULTS.upstream,
					hostsText: DEFAULTS.hosts.join("\n"),
				});

				const field = (key, value) => {
					setDraft((d) => ({ ...d, [key]: value }));
					setMeta((m) => ({ ...m, saved: false }));
				};

				useEffect(() => {
					let alive = true;
					(async () => {
						try {
							const entry = await readDescriptor(getRemote());
							if (!alive) return;
							const r = entry.resolved || DEFAULTS;
							setDraft({
								enabled: !!r.enabled,
								upstream: String(r.upstream ?? DEFAULTS.upstream),
								hostsText: Array.isArray(r.hosts) ? r.hosts.join("\n") : DEFAULTS.hosts.join("\n"),
							});
							setMeta({ loading: false, error: "", saved: false, revision: entry.revision, writable: entry.writable, busy: false });
						} catch (error) {
							if (alive) setMeta({ loading: false, error: String((error && error.message) || error), saved: false, revision: undefined, writable: false, busy: false });
						}
					})();
					return () => { alive = false; };
				}, [reload]);

				const save = async () => {
					if (!meta.writable || meta.busy) return;
					const remote = getRemote();
					const hosts = draft.hostsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
					if (hosts.length === 0) {
						setMeta((m) => ({ ...m, error: "至少需要一个域名后缀", saved: false }));
						return;
					}
					const value = {
						enabled: !!draft.enabled,
						upstream: draft.upstream.trim() || DEFAULTS.upstream,
						hosts,
					};
					const ops = FIELDS.map((key) => ({ op: "set", path: [key], value: value[key] }));
					setMeta((m) => ({ ...m, error: "", saved: false, busy: true }));
					try {
						const response = await remote.settings.mutate(NS, ops, meta.revision);
						unwrap(response);
						const entry = await readDescriptor(remote);
						setMeta({ loading: false, error: "", saved: true, revision: entry.revision, writable: entry.writable, busy: false });
					} catch (error) {
						setMeta((m) => ({ ...m, error: String((error && error.message) || error), saved: false, busy: false }));
					}
				};

				const resetDefaults = async () => {
					if (!meta.writable || meta.busy) return;
					const remote = getRemote();
					setMeta((m) => ({ ...m, error: "", saved: false, busy: true }));
					try {
						const ops = FIELDS.map((key) => ({ op: "unset", path: [key] }));
						const response = await remote.settings.mutate(NS, ops, meta.revision);
						unwrap(response);
						const entry = await readDescriptor(remote);
						const r = entry.resolved || DEFAULTS;
						setDraft({
							enabled: !!r.enabled,
							upstream: String(r.upstream ?? DEFAULTS.upstream),
							hostsText: Array.isArray(r.hosts) ? r.hosts.join("\n") : DEFAULTS.hosts.join("\n"),
						});
						setMeta({ loading: false, error: "", saved: true, revision: entry.revision, writable: entry.writable, busy: false });
					} catch (error) {
						setMeta((m) => ({ ...m, error: String((error && error.message) || error), saved: false, busy: false }));
					}
				};

				if (meta.loading) {
					return h("div", { style: styles.page }, h("p", { style: styles.desc }, "加载中…"));
				}

				return h("div", { style: styles.page },
					h("h2", { style: styles.title }, "Codex 分流代理"),
					h("p", { style: styles.desc },
						"在 DSH 进程内按域名分流：只有下方列出的域名经上游代理转发，其余所有请求一律直连。无需任何启动参数，修改保存后立即生效。"),
					h("label", { style: { ...styles.row, flexDirection: "row", alignItems: "center", gap: "8px" } },
						h("input", {
							type: "checkbox", style: styles.checkbox, checked: !!draft.enabled, disabled: !meta.writable || meta.busy,
							onChange: (e) => field("enabled", e.target.checked),
						}),
						h("span", { style: styles.label }, "启用分流"),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "上游代理"),
						h("input", {
							style: styles.input, value: draft.upstream, disabled: !meta.writable || meta.busy,
							onChange: (e) => field("upstream", e.target.value),
							spellCheck: false, placeholder: "http://127.0.0.1:7890",
						}),
						h("span", { style: styles.hint }, "仅用于上方域名的本地代理客户端地址（支持 Clash 混合端口等）。"),
					),
					h("div", { style: styles.row },
						h("span", { style: styles.label }, "走代理的域名"),
						h("textarea", {
							style: { ...styles.input, minHeight: "76px", resize: "vertical", lineHeight: "20px" },
							value: draft.hostsText, disabled: !meta.writable || meta.busy,
							onChange: (e) => field("hostsText", e.target.value),
							spellCheck: false,
						}),
						h("span", { style: styles.hint }, "每行一个域名后缀，子域自动匹配；回环地址永不走代理。"),
					),
					h("div", { style: styles.footer },
						h("button", { style: styles.primary, onClick: save, disabled: !meta.writable || meta.busy }, meta.busy ? "保存中…" : "保存"),
						h("button", { style: styles.ghost, onClick: resetDefaults, disabled: !meta.writable || meta.busy }, "恢复默认"),
						meta.error ? h("button", { style: styles.ghost, onClick: () => setReload((n) => n + 1), disabled: meta.busy }, "重新读取") : null,
						meta.error ? h("span", { style: styles.error }, meta.error)
							: meta.saved ? h("span", { style: styles.status }, "已保存，热生效 ✓")
								: h("span", { style: styles.status }, meta.writable ? "" : "当前设置为只读"),
					),
				);
			}
			return CodexSection;
		}

		function apply(ctx) {
			const getRemote = () => ctx.remote;
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "codex",
				order: 80,
				label: "Codex",
			}, makeSection(getRemote)));
		}

		exports.apply = apply;
		exports.inject = ["slots", "remote", "remote.settings"];
		return module.exports;
	}
});
