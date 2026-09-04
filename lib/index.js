// dsh-codex — Codex split-routing proxy (host half).
//
// Wraps globalThis.fetch inside the DSH process: requests whose hostname is
// on the allow-list (default chatgpt.com, auth.openai.com) are tunneled to an
// upstream HTTP proxy (CONNECT + TLS); every other request uses the original
// fetch untouched. Nothing is required at launch — no env vars, no launcher.
//
// Configuration lives in the `codex` settings namespace, layered as schema
// defaults <- composition base (this row's cordis.patch.yml config) <- user
// document (~/.dsh/settings.yaml `codex:` section, edited in the DSH settings
// UI). The wrapper reads the current value on every request, so changes
// apply immediately without re-wrapping.
//
// Note: pi-ai's Codex transport prefers WebSocket when left on `auto`; a
// WebSocket does not go through fetch, so the openai-codex provider route
// should set `transport: sse` (a supported llm-pi-ai profile field).

import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import zlib from "node:zlib";
import { URL } from "node:url";
import SchemaMod from "@deepseek-ai/schemastery";

const Schema = SchemaMod?.default ?? SchemaMod;

const name = "dsh-codex";
const NS = "codex";

// cordis service dependency: ctx.settings may only be touched after declaring
// the inject, otherwise entry init throws "cannot get property without inject"
// and the whole composition (dsh web) fails to boot.
const inject = ["settings"];

const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("Route allow-listed hosts through the upstream proxy."),
  upstream: Schema.string().default("http://127.0.0.1:7890").description("Upstream HTTP proxy used ONLY for the hosts below (e.g. your local VPN client)."),
  hosts: Schema.array(Schema.string()).default(["chatgpt.com", "auth.openai.com"]).description("Host suffixes routed through the upstream proxy; every other destination uses the original fetch."),
});

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostMatches(host, domains) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").split(":")[0];
  if (!h || LOOPBACK.has(h)) return false;
  return domains.some((d) => {
    const domain = String(d || "").toLowerCase().trim();
    return !!domain && (h === domain || h.endsWith("." + domain));
  });
}

function fetchURL(input) {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(String(input));
    if (input && typeof input.url === "string") return new URL(input.url);
  } catch { /* not a URL we understand */ }
  return undefined;
}

// An https.Agent whose connections are CONNECT tunnels through the upstream proxy.
class TunnelAgent extends https.Agent {
  constructor(upstreamUrl, options = {}) {
    super({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 16, ...options });
    this.upstream = new URL(upstreamUrl);
  }

  createConnection(options, callback) {
    const host = options.host || options.hostname;
    const port = options.port || 443;
    let settled = false;
    const done = (err, socket) => {
      if (settled) return;
      settled = true;
      callback(err, socket);
    };

    const upstreamPort = Number(this.upstream.port) || 80;
    const socket = net.connect({ host: this.upstream.hostname, port: upstreamPort });
    socket.once("error", (err) => done(err));

    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffer.length > 16 * 1024) {
          socket.destroy();
          done(new Error("dsh-codex: oversized CONNECT response from upstream"));
        }
        return;
      }
      socket.removeListener("data", onData);
      const head = buffer.subarray(0, end).toString("latin1");
      const match = /^HTTP\/1\.[01] (\d{3})/i.exec(head);
      const code = match ? Number(match[1]) : 0;
      if (!match || code < 200 || code >= 300) {
        socket.destroy();
        done(new Error(`dsh-codex: upstream CONNECT refused: ${head.split("\r\n")[0]}`));
        return;
      }
      const tlsSocket = tls.connect(
        { socket, servername: host, ALPNProtocols: ["http/1.1"] },
        () => done(null, tlsSocket),
      );
      tlsSocket.once("error", (err) => {
        if (!settled) done(err);
        else tlsSocket.destroy();
      });
    };
    socket.once("connect", () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    socket.on("data", onData);
  }
}

function requestHeaders(input, init) {
  const headers = new Headers(input && typeof input === "object" ? input.headers : undefined);
  if (init && init.headers !== undefined) {
    for (const [key, value] of new Headers(init.headers).entries()) headers.set(key, value);
  }
  const out = {};
  for (const [key, value] of headers.entries()) out[key] = value;
  return out;
}

async function writeRequestBody(req, body, signal) {
  if (body == null) {
    req.end();
    return;
  }
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    req.end(body);
    return;
  }
  if (body instanceof Uint8Array) {
    req.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
    return;
  }
  if (body instanceof ArrayBuffer) {
    req.end(Buffer.from(body));
    return;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    req.end(Buffer.from(await body.arrayBuffer()));
    return;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    req.end(body.toString());
    return;
  }
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      for (;;) {
        if (signal && signal.aborted) throw new Error("The operation was aborted");
        const { done, value } = await reader.read();
        if (done) break;
        if (!req.write(value)) await new Promise((resolve) => req.once("drain", resolve));
      }
      req.end();
    } catch (error) {
      req.destroy(error);
    }
    return;
  }
  req.end(String(body));
}

function toWebResponse(res, url) {
  const encoding = String(res.headers["content-encoding"] || "").trim().toLowerCase();
  let decoded = false;
  let stream = res;
  if (encoding === "gzip" || encoding === "x-gzip") {
    stream = res.pipe(zlib.createGunzip());
    decoded = true;
  } else if (encoding === "deflate") {
    stream = res.pipe(zlib.createInflate());
    decoded = true;
  } else if (encoding === "br") {
    stream = res.pipe(zlib.createBrotliDecompress());
    decoded = true;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    const lower = key.toLowerCase();
    if (decoded && (lower === "content-encoding" || lower === "content-length")) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, String(item)));
    else headers.append(key, String(value));
  }

  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      stream.on("end", () => {
        try { controller.close(); } catch { /* already closed */ }
      });
      stream.on("error", (error) => {
        try { controller.error(error); } catch { /* already errored */ }
      });
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(body, {
    status: res.statusCode,
    statusText: res.statusMessage,
    headers,
  });
}

// Perform one https request for `url` through the upstream proxy tunnel.
function proxiedFetch(url, input, init, agent) {
  return new Promise((resolve, reject) => {
    const method = (init && init.method)
      || (input && typeof input === "object" && input.method)
      || "GET";
    const signal = (init && init.signal)
      || (input && typeof input === "object" ? input.signal : undefined);

    const req = https.request(url, {
      method,
      headers: requestHeaders(input, init),
      agent,
    });

    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch { /* already gone */ }
      reject(error);
    };

    if (signal && signal.aborted) {
      fail(new Error("The operation was aborted"));
      return;
    }
    if (signal) {
      const onAbort = () => fail(new Error("The operation was aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      req.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    req.once("error", fail);

    req.once("response", (res) => {
      if (settled) return;
      settled = true;
      resolve(toWebResponse(res, url));
    });

    if (method === "GET" || method === "HEAD") {
      req.end();
    } else {
      const body = init && init.body !== undefined
        ? init.body
        : (input && typeof input === "object" ? input.body : undefined);
      writeRequestBody(req, body, signal).catch(fail);
    }
  });
}

function apply(ctx, config = {}) {
  const logger = ctx.logger("dsh-codex");

  const scope = ctx.settings.register(NS, Config, { base: config });
  let cfg = scope.get();
  scope.watch((next) => {
    cfg = next;
    logger.info(`split-routing updated: upstream ${next.upstream} for [${next.hosts.join(", ")}]`);
  });

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") {
    logger.error("globalThis.fetch is unavailable; split-routing disabled");
    return;
  }

  let agent = undefined;

  const wrappedFetch = function (input, init) {
    let url;
    let tunnel = false;
    try {
      url = fetchURL(input);
      tunnel = cfg.enabled
        && !!url
        && url.protocol === "https:"
        && hostMatches(url.hostname, cfg.hosts);
    } catch { /* fall through to original fetch */ }
    if (!tunnel) return originalFetch.call(this, input, init);
    try {
      if (!agent || agent.upstreamHref !== cfg.upstream) {
        if (agent) agent.destroy();
        agent = new TunnelAgent(cfg.upstream);
        agent.upstreamHref = cfg.upstream;
      }
      return proxiedFetch(url, input, init, agent);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  globalThis.fetch = wrappedFetch;
  logger.info(`split-routing active: [${cfg.hosts.join(", ")}] -> ${cfg.upstream}, everything else direct`);

  return () => {
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    if (agent) agent.destroy();
  };
}

export { apply, name, Config, NS, inject };
