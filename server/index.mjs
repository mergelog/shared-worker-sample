// 外部サービスなしでAPIとWebSocketを試せる、小さなローカルサーバー。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const preview = process.argv.includes("--preview");
const port = Number(process.env.PORT ?? (preview ? 4200 : 3001));
const staticRoot = resolve(
  fileURLToPath(
    new URL("../dist/shared-worker-sample/browser/", import.meta.url),
  ),
);
let apiRequests = 0;
const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (url.pathname === "/api/product") {
    const requestId = ++apiRequests;
    // 同時リクエストの集約を観察しやすくするため、少し遅延を入れる。
    await new Promise((done) => setTimeout(done, 300));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        product: { id: 1, name: "サンプル商品", price: 1000 },
        requestId,
        fetchedAt: new Date().toISOString(),
      }),
    );
    return;
  }
  if (url.pathname === "/api/stats") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ apiRequests, activeConnections: sockets.clients.size }),
    );
    return;
  }
  if (!preview || url.pathname.startsWith("/api/")) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(
      staticRoot,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(staticRoot + sep)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response
      .writeHead(404)
      .end("Not found. Run npm run build before npm run preview.");
  }
});

server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url ?? "/", "http://localhost").pathname !== "/socket") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) =>
    sockets.emit("connection", client),
  );
});

sockets.on("connection", (socket) => {
  const connectionId = randomUUID().slice(0, 8);
  const send = (kind, text) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        kind,
        text,
        connectionId,
        activeConnections: sockets.clients.size,
        timestamp: new Date().toISOString(),
      }),
    );
  };
  send("connected", "Hello from WebSocket!");
  socket.on("message", (data) =>
    send("echo", `Echo: ${data.toString().slice(0, 200)}`),
  );
  socket.on("error", (error) => console.error("WebSocket:", error.message));
  const timer = setInterval(
    () => send("tick", "サーバーからの定期メッセージ"),
    5000,
  );
  socket.on("close", () => clearInterval(timer));
});

server.listen(port, "127.0.0.1", () =>
  console.log(
    `Local ${preview ? "preview + " : ""}API / WebSocket: http://localhost:${port}`,
  ),
);

function shutdown() {
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
