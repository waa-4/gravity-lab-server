// server.js
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

// --- Basic HTTP server so Render has something to ping/see ---
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Gravity Lab WS: OK");
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// --- WebSocket server attached to HTTP server ---
const wss = new WebSocket.Server({ server });

/**
 * rooms = {
 *   CODE: {
 *     clients: Map(clientId -> ws),
 *     states: Map(clientId -> { objects: [...] }),
 *     settings: { params, colors, perf },
 *   }
 * }
 */
const rooms = Object.create(null);

function getRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      clients: new Map(),
      states: new Map(),
      settings: null,
      lastActive: Date.now(),
    };
  }
  rooms[code].lastActive = Date.now();
  return rooms[code];
}

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(roomCode, obj, exceptId = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const msg = JSON.stringify(obj);

  for (const [id, client] of room.clients.entries()) {
    if (exceptId && id === exceptId) continue;
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// Cleanup empty rooms occasionally
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    // delete if empty or inactive a long time
    if (room.clients.size === 0 && now - room.lastActive > 10 * 60 * 1000) {
      delete rooms[code];
    }
  }
}, 60 * 1000);

wss.on("connection", (ws) => {
  const clientId = Math.random().toString(36).slice(2);
  ws.__id = clientId;
  ws.__room = null;

  // Tell client their id (helpful for debugging)
  send(ws, { type: "hello", id: clientId });

  ws.on("message", (raw) => {
    const data = safeJsonParse(raw);
    if (!data || typeof data.type !== "string") return;

    // JOIN
    if (data.type === "join") {
      const roomCode = String(data.room || "").trim().toUpperCase();
      if (!roomCode) return send(ws, { type: "error", message: "Missing room code" });

      // leave previous room if any
      if (ws.__room) {
        leaveRoom(ws);
      }

      ws.__room = roomCode;
      const room = getRoom(roomCode);

      room.clients.set(clientId, ws);

      // Send current room settings if any
      if (room.settings) {
        send(ws, { type: "settings", from: "server", room: roomCode, payload: room.settings });
      }

      // Send existing states so new client can see others immediately
      for (const [otherId, state] of room.states.entries()) {
        send(ws, { type: "state", from: otherId, room: roomCode, payload: state });
      }

      // Notify others someone joined (optional)
      broadcast(roomCode, { type: "presence", room: roomCode, from: "server", joined: clientId }, clientId);

      return;
    }

    // Ignore other messages if not in a room
    if (!ws.__room) return;

    const roomCode = ws.__room;
    const room = getRoom(roomCode);

    // STATE update (matches your HTML "syncState")
    if (data.type === "state") {
      // Expect payload: { objects: [...] }
      if (!data.payload || !Array.isArray(data.payload.objects)) return;

      // Store latest state for this client
      room.states.set(clientId, data.payload);

      // Broadcast to others
      broadcast(roomCode, { type: "state", from: clientId, room: roomCode, payload: data.payload }, clientId);
      return;
    }

    // SETTINGS update (host broadcasts to all)
    if (data.type === "settings") {
      if (!data.payload || typeof data.payload !== "object") return;

      // Save last settings (room-wide)
      room.settings = data.payload;

      // Broadcast to everyone (including sender OK, but we can skip sender)
      broadcast(roomCode, { type: "settings", from: clientId, room: roomCode, payload: data.payload }, clientId);
      return;
    }

    // LEAVE
    if (data.type === "leave") {
      leaveRoom(ws);
      return;
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

function leaveRoom(ws) {
  const roomCode = ws.__room;
  if (!roomCode || !rooms[roomCode]) return;

  const room = rooms[roomCode];
  const id = ws.__id;

  room.clients.delete(id);
  room.states.delete(id);
  room.lastActive = Date.now();

  // Tell others they left
  broadcast(roomCode, { type: "leave", from: id, room: roomCode });

  ws.__room = null;

  // Clean if empty
  if (room.clients.size === 0) {
    // keep it briefly in case someone reconnects fast; cleanup interval handles final deletion
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("Gravity Lab server listening on", PORT);
});

