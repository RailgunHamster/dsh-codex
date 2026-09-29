import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { apply, Config } from "../lib/index.js";

// DSH commits settings-form edits by writing a new snapshot into the plugin's
// existing reference (cosmokit updateVolatile) instead of remounting it.
const write = Symbol.for("cosmokit.volatile.write");
const ctx = { logger: () => ({ info() {}, error() {} }) };

async function refusingUpstream(t) {
  const connects = [];
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      connects.push(chunk.toString("latin1").split("\r\n")[0]);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, connects };
}

function mount(t, value) {
  const original = globalThis.fetch;
  const direct = [];
  const baseFetch = async (input) => {
    direct.push(String(input));
    return new Response("direct");
  };
  globalThis.fetch = baseFetch;
  const config = Config(value);
  const dispose = apply(ctx, config);
  t.after(() => {
    dispose();
    globalThis.fetch = original;
  });
  return { config, direct, baseFetch, dispose };
}

test("the whole Config is volatile so DSH lists it as a live settings form", () => {
  assert.equal(Config.meta.volatile, true);
  assert.deepEqual(Config({}).get(), {
    enabled: true,
    upstream: "http://127.0.0.1:7890",
    hosts: ["chatgpt.com", "auth.openai.com"],
  });
});

test("hosts outside the allow-list use the original fetch", async (t) => {
  const upstream = await refusingUpstream(t);
  const { direct } = mount(t, { upstream: upstream.url, hosts: ["chatgpt.com"] });
  const res = await fetch("https://example.com/x");
  assert.equal(await res.text(), "direct");
  assert.deepEqual(direct, ["https://example.com/x"]);
  assert.deepEqual(upstream.connects, []);
});

test("allow-listed hosts are tunneled through the upstream proxy", async (t) => {
  const upstream = await refusingUpstream(t);
  const { direct } = mount(t, { upstream: upstream.url, hosts: ["chatgpt.com"] });
  await assert.rejects(fetch("https://api.chatgpt.com/backend-api"), /upstream CONNECT refused: HTTP\/1\.1 403/);
  assert.deepEqual(upstream.connects, ["CONNECT api.chatgpt.com:443 HTTP/1.1"]);
  assert.deepEqual(direct, []);
});

test("edits to the volatile reference apply to the next request without remounting", async (t) => {
  const upstream = await refusingUpstream(t);
  const { config, direct } = mount(t, { upstream: upstream.url, hosts: ["chatgpt.com"] });

  config[write]({ ...config.get(), enabled: false });
  assert.equal(await (await fetch("https://chatgpt.com/")).text(), "direct");

  config[write]({ ...config.get(), enabled: true, hosts: ["example.org"] });
  assert.equal(await (await fetch("https://chatgpt.com/")).text(), "direct");
  await assert.rejects(fetch("https://example.org/"), /upstream CONNECT refused/);

  assert.deepEqual(direct, ["https://chatgpt.com/", "https://chatgpt.com/"]);
  assert.deepEqual(upstream.connects, ["CONNECT example.org:443 HTTP/1.1"]);
});

test("dispose restores the original fetch", async (t) => {
  const { baseFetch, dispose } = mount(t, {});
  assert.notEqual(globalThis.fetch, baseFetch);
  dispose();
  assert.equal(globalThis.fetch, baseFetch);
});
