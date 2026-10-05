import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC = join(process.cwd(), "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
let nextId = 1;
const clients = new Map(); // ws -> {id, name, host}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj, except) {
  for (const ws of clients.keys()) if (ws !== except) send(ws, obj);
}
function peersList() {
  return [...clients.values()].map((c) => ({ id: c.id, name: c.name }));
}

wss.on("connection", (ws) => {
  const id = nextId++;
  const host = clients.size === 0;
  clients.set(ws, { id, name: "Player" + id, host });
  send(ws, { t: "you", id, host });
  broadcast({ t: "joined", id, name: clients.get(ws).name }, ws);
  send(ws, { t: "peers", people: peersList() });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = clients.get(ws);
    if (!me) return;
    switch (msg.t) {
      case "join":
        me.name = String(msg.name || me.name).slice(0, 24);
        broadcast({ t: "joined", id: me.id, name: me.name }, ws);
        send(ws, { t: "peers", people: peersList() });
        break;
      case "state":
        broadcast(
          {
            t: "relay",
            from: me.id,
            msg: {
              t: "state",
              x: msg.x,
              z: msg.z,
              heading: msg.heading,
              v: msg.v,
              lap: msg.lap,
              s: msg.s,
            },
          },
          ws
        );
        break;
      case "track":
        broadcast({ t: "track", preset: msg.preset, from: me.id }, ws);
        break;
      case "start":
        broadcast({ t: "start", countdownAt: msg.countdownAt, from: me.id }, ws);
        break;
      case "finish":
        broadcast({ t: "finish", ms: msg.ms, from: me.id }, ws);
        break;
    }
  });

  ws.on("close", () => {
    const me = clients.get(ws);
    clients.delete(ws);
    if (me) {
      broadcast({ t: "left", id: me.id });
      if (me.host) {
        const next = [...clients.entries()][0];
        if (next) {
          next[1].host = true;
          send(next[0], { t: "you", id: next[1].id, host: true });
        }
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`polyTRACK → http://localhost:${PORT}`)
);
