// dsh-codex — Codex split-routing proxy (host half).
//
// Runs a tiny local HTTP forward proxy inside the DSH process. Node's global
// fetch is pointed at it at launch (Node 24+: NODE_USE_ENV_PROXY=1 plus
// HTTP(S)_PROXY=http://127.0.0.1:<listenPort>); only the hosts listed in the
// `codex` settings namespace are chained to `upstream` (your VPN proxy client),
// everything else is forwarded over a direct connection.
//
// Configuration lives in the `codex` settings namespace, layered as
// schema defaults <- composition base (this row's cordis.patch.yml config)
// <- user document (~/.dsh/settings.yaml `codex:` section, edited in the DSH
// settings UI). Changes hot-apply: the listener restarts on every commit.

import net from "node:net";
import http from "node:http";
import { URL } from "node:url";
import SchemaMod from "@deepseek-ai/schemastery";

const Schema = SchemaMod?.default ?? SchemaMod;

const name = "dsh-codex";
const NS = "codex";

const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("Start the split-routing proxy listener."),
  listenHost: Schema.string().default("127.0.0.1").description("Bind address of the local forward proxy."),
  listenPort: Schema.number().default(17890).description("Bind port of the local forward proxy."),
  upstream: Schema.string().default("http://127.0.0.1:7890").description("Upstream proxy used ONLY for the hosts below (e.g. your local VPN client)."),
  hosts: Schema.array(Schema.string()).default(["chatgpt.com", "auth.openai.com"]).description("Host suffixes routed through the upstream proxy; every other destination connects directly."),
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

function pipeBoth(a, b) {
  a.pipe(b);
  b.pipe(a);
}

// Create the forward proxy server for one resolved config snapshot.
// Returns { server, sockets, dispose() }.
function createProxy(cfg) {
  const upstream = new URL(cfg.upstream);
  const upstreamPort = Number(upstream.port) || (upstream.protocol === "https:" ? 443 : 80);
  const sockets = new Set();
  let disposed = false;

  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  const server = http.createServer(function handlePlainHttp(req, res) {
    // absolute-form http:// request (plain HTTP through a proxy)
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("dsh-codex: bad absolute-form request");
      return;
    }

    const headers = Object.assign({}, req.headers);
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];

    const fail = (err) => {
      try {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("dsh-codex: " + err.message);
      } catch { /* socket already gone */ }
    };

    const viaUpstream = hostMatches(target.hostname, cfg.hosts);
    if (viaUpstream) {
      const up = http.request({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      up.on("error", fail);
      req.pipe(up);
    } else {
      headers.host = target.host;
      const direct = http.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: Number(target.port) || 80,
        method: req.method,
        path: target.pathname + target.search,
        headers,
      }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      direct.on("error", fail);
      req.pipe(direct);
    }
  });

  server.on("connect", (req, clientSocket, head) => {
    track(clientSocket);
    const target = String(req.url || "");
    const idx = target.lastIndexOf(":");
    const host = idx === -1 ? target : target.slice(0, idx);
    const port = idx === -1 ? 443 : Number(target.slice(idx + 1)) || 443;

    const fail = (msg, code) => {
      try { clientSocket.end(`HTTP/1.1 ${code} ${msg}\r\n\r\n`); } catch { /* gone */ }
    };
    clientSocket.on("error", () => { /* client vanished */ });

    if (hostMatches(host, cfg.hosts)) {
      // chained CONNECT: ask the upstream proxy for a tunnel to the target
      const upReq = http.request({
        hostname: upstream.hostname,
        port: upstreamPort,
        method: "CONNECT",
        path: `${host}:${port}`,
        headers: { Host: `${host}:${port}` },
      });
      upReq.once("connect", (upRes, upSocket, upHead) => {
        track(upSocket);
        if (upRes.statusCode >= 200 && upRes.statusCode < 300) {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (upHead && upHead.length) clientSocket.write(upHead);
          upSocket.on("error", () => clientSocket.destroy());
          pipeBoth(clientSocket, upSocket);
        } else {
          upSocket.destroy();
          fail(`Upstream Refused (${upRes.statusCode})`, 502);
        }
      });
      upReq.on("error", (err) => fail("Upstream Error: " + err.message, 502));
      upReq.end();
    } else {
      const upSocket = net.connect(port, host);
      track(upSocket);
      upSocket.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upSocket.write(head);
        pipeBoth(clientSocket, upSocket);
      });
      upSocket.once("error", (err) => fail("Direct Connect Error: " + err.message, 502));
    }
  });

  server.on("clientError", (err, socket) => {
    try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch { /* gone */ }
  });

  const listening = new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.listen(cfg.listenPort, cfg.listenHost);

  return {
    server,
    listening,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function apply(ctx, config = {}) {
  const logger = ctx.logger("dsh-codex");
  // the composition row config is the namespace base layer
  const scope = ctx.settings.register(NS, Config, { base: config });

  let current = undefined;

  const describe = (cfg) =>
    `${cfg.listenHost}:${cfg.listenPort} -> ${cfg.upstream} for [${cfg.hosts.join(", ")}]`;

  const start = (cfg) => {
    if (!cfg.enabled) {
      logger.info("split-routing proxy disabled");
      return;
    }
    current = createProxy(cfg);
    current.listening.then(
      () => logger.info(`split-routing proxy listening on ${describe(cfg)}`),
      (error) => {
        logger.error(`failed to listen on ${cfg.listenHost}:${cfg.listenPort}: ${error.message}`);
        current = undefined;
      },
    );
  };

  const stop = async () => {
    const previous = current;
    current = undefined;
    if (previous) await previous.dispose();
  };

  start(scope.get());

  // hot-apply: restart the listener on every settings commit
  const unwatch = scope.watch(async (next) => {
    await stop();
    start(next);
  });

  return async () => {
    unwatch();
    await stop();
  };
}

export { apply, name, Config, NS };
