// SharedWorker の本体。public/ からそのまま配信され、全タブで1回だけ実行される。
// JSDoc + tsconfig.worker.json で、Angular と同じメッセージ型をチェックする。
/** @typedef {import('../src/app/shared/protocol').ClientMessage} ClientMessage */
/** @typedef {import('../src/app/shared/protocol').WorkerMessage} WorkerMessage */
/** @typedef {import('../src/app/shared/protocol').ApiData} ApiData */
/** @typedef {import('../src/app/shared/protocol').SocketStatus} SocketStatus */

const worker = /** @type {SharedWorkerGlobalScope} */ (
  /** @type {unknown} */ (self)
);
const workerId = crypto.randomUUID().slice(0, 8);
/** @type {Map<MessagePort, string>} */
const ports = new Map();
let counter = 0;

/** 特定のタブに送る。 @param {MessagePort} port @param {WorkerMessage} message */
function send(port, message) {
  port.postMessage(message);
}

/** 全タブに配る。通知だけは送信元を除外する。 @param {WorkerMessage} message @param {MessagePort} [except] */
function broadcast(message, except) {
  for (const port of ports.keys()) {
    if (port !== except) send(port, message);
  }
}

function publishSnapshot() {
  broadcast({
    type: "snapshot",
    state: {
      counter,
      tabs: ports.size,
      cache,
      cacheLoading: inFlight !== null,
      socketStatus,
    },
  });
}

// 1. 状態共有: 値を持つのはタブではなく Worker。ここで更新してから全タブに配る。
/** @param {boolean} reset */
function changeCounter(reset) {
  counter = reset ? 0 : counter + 1;
  publishSnapshot();
}

// 2. WebSocket共有: 全ポートからの接続要求を、1つの socket に集約する。
/** @type {WebSocket | null} */
let socket = null;
/** @type {SocketStatus} */
let socketStatus = "disconnected";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let reconnectTimer;
let wantsSocket = false;

function connectSocket() {
  wantsSocket = true;
  if (socket || reconnectTimer !== undefined) return;
  socketStatus = "connecting";
  publishSnapshot();
  const url = new URL("/socket", worker.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const current = new WebSocket(url);
  socket = current;
  current.onopen = () => {
    if (socket !== current) return;
    socketStatus = "connected";
    publishSnapshot();
  };
  current.onmessage = (event) => {
    if (socket !== current) return;
    try {
      broadcast({ type: "socket:message", message: JSON.parse(event.data) });
    } catch {
      broadcast({
        type: "error",
        message: "WebSocketの応答を読み取れませんでした。",
      });
    }
  };
  current.onerror = () => {
    if (socket !== current) return;
    broadcast({
      type: "error",
      message:
        "WebSocketに接続できません。ローカルサーバーを確認してください。",
    });
  };
  current.onclose = () => {
    if (socket !== current) return;
    socket = null;
    socketStatus =
      wantsSocket && ports.size > 0 ? "reconnecting" : "disconnected";
    if (socketStatus === "reconnecting") {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connectSocket();
      }, 1000);
    }
    publishSnapshot();
  };
}

// 3. データキャッシュ: 結果だけでなく取得中の Promise も共有し、同時要求を1回にまとめる。
const CACHE_TTL_MS = 30_000;
/** @type {ApiData | null} */
let cache = null;
let expiresAt = 0;
/** @type {Promise<ApiData> | null} */
let inFlight = null;

/** @param {boolean} refresh @param {string} requestedBy */
async function getCachedData(refresh, requestedBy) {
  if (!refresh && cache && Date.now() < expiresAt) {
    broadcast({ type: "cache:result", source: "cache", requestedBy });
    return;
  }
  const source = inFlight ? "in-flight" : "network";
  if (!inFlight) {
    inFlight = fetch("/api/hello", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`API: HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        cache = data;
        expiresAt = Date.now() + CACHE_TTL_MS;
        return data;
      })
      .finally(() => {
        inFlight = null;
        publishSnapshot();
      });
    publishSnapshot();
  }
  try {
    await inFlight;
    broadcast({ type: "cache:result", source, requestedBy });
  } catch (error) {
    broadcast({
      type: "error",
      message: `API取得に失敗しました: ${String(error)}`,
    });
  }
}

// 4. タブ間通信: 永続化せず、いま開いている他のタブにだけ通知する。
/** @param {MessagePort} port @param {ClientMessage} message */
function handleMessage(port, message) {
  const tabId = ports.get(port);
  if (!tabId) return;
  switch (message.type) {
    case "counter:increment":
      changeCounter(false);
      break;
    case "counter:reset":
      changeCounter(true);
      break;
    case "socket:connect":
      connectSocket();
      break;
    case "socket:send":
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(message.text.slice(0, 200));
      } else {
        send(port, {
          type: "error",
          message: "先にWebSocketを接続してください。",
        });
      }
      break;
    case "cache:get":
      void getCachedData(message.refresh, tabId);
      break;
    case "notify":
      broadcast(
        {
          type: "notification",
          from: tabId,
          text: message.text.slice(0, 200),
          timestamp: new Date().toISOString(),
        },
        port,
      );
      break;
    case "disconnect":
      ports.delete(port);
      port.close();
      if (ports.size === 0) {
        wantsSocket = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        const previous = socket;
        socket = null;
        previous?.close();
        socketStatus = "disconnected";
      }
      publishSnapshot();
      break;
  }
}

// タブごとに connect が呼ばれ、専用の MessagePort が渡される。
worker.addEventListener("connect", (event) => {
  const port = event.ports[0];
  const tabId = crypto.randomUUID().slice(0, 8);
  ports.set(port, tabId);
  port.addEventListener("message", (event) => handleMessage(port, event.data));
  port.start(); // addEventListener を使うときは明示的に開始する。
  send(port, {
    type: "hello",
    tabId,
    workerId,
    message: "Hello from SharedWorker!",
  });
  publishSnapshot(); // 後から開いたタブにも、現在の状態を渡す。
});
