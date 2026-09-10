import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise the shipped browser module against the DSH 0.1.5 wire contract.
function mount(remote) {
  const states = [], effects = [];
  let cursor = 0, component, initialized = false, plugin;
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useEffect(effect) { if (!initialized) effects.push(effect); },
  };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory(() => react); } } },
  });
  plugin.apply({ remote, slots: { inject(_name, callback) { callback(); }, register(_slot, view) { component = view; } } });
  const render = () => { cursor = 0; return component({}); };
  return {
    async ready() { render(); initialized = true; effects.forEach((effect) => effect()); await new Promise(setImmediate); return render(); },
    render,
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...tree.children.flatMap(nodes)];
}
const button = (tree, label) => nodes(tree).find((node) => node.tag === "button" && node.children.includes(label));

test("loads namespace values and uses positional mutations with per-namespace revisions", async () => {
  const calls = [];
  let revision = 7;
  const value = { enabled: false, upstream: "http://127.0.0.1:17890", hosts: ["example.org"] };
  const page = mount({ settings: {
    async describe(...args) {
      assert.equal(args.length, 0);
      return { ok: true, value: { writable: true, namespaces: [{ ns: "codex", value, revision }] } };
    },
    async mutate(...args) { calls.push(args); revision++; return { ok: true, value: { ns: "codex", value, revision } }; },
  } });
  let tree = await page.ready();
  assert.equal(nodes(tree).find((node) => node.tag === "input" && node.props.type === "checkbox").props.checked, false);
  assert.equal(nodes(tree).find((node) => node.props.placeholder).props.value, value.upstream);
  await button(tree, "保存").props.onClick();
  assert.equal(calls[0][0], "codex");
  assert.equal(calls[0][2], 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), [
    { op: "set", path: ["enabled"], value: false },
    { op: "set", path: ["upstream"], value: value.upstream },
    { op: "set", path: ["hosts"], value: value.hosts },
  ]);
  tree = page.render();
  await button(tree, "恢复默认").props.onClick();
  assert.equal(calls[1][2], 8);
  assert.ok(calls[1][1].every((op) => op.op === "unset"));
});

test("failed or missing reads never enable saving guessed defaults", async () => {
  for (const response of [
    { ok: false, error: { message: "connection lost" } },
    { ok: true, value: { writable: true, namespaces: [] } },
    { ok: true, value: { writable: false, namespaces: [{ ns: "codex", value: {}, revision: 1 }] } },
  ]) {
    let writes = 0;
    const page = mount({ settings: { describe: async () => response, mutate: async () => { writes++; } } });
    const tree = await page.ready();
    assert.equal(button(tree, "保存").props.disabled, true);
    await button(tree, "保存").props.onClick();
    assert.equal(writes, 0);
  }
});

test("a rejected mutation is visible and is never displayed as saved", async () => {
  const page = mount({ settings: {
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: "codex", value: {}, revision: 2 }] } }),
    mutate: async () => ({ ok: false, error: { message: "settings revision conflict" } }),
  } });
  await button(await page.ready(), "保存").props.onClick();
  const tree = page.render();
  assert.match(JSON.stringify(tree), /settings revision conflict/);
  assert.doesNotMatch(JSON.stringify(tree), /已保存，热生效/);
  assert.ok(button(tree, "重新读取"));
});
