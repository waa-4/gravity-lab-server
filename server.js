const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {};

function makeRoom() {
  return {
    players: {},
    settings: {
      gravity: 1,
      maxChars: 1000,
      tilt: true
    }
  };
}

function broadcast(roomId, data) {
  const msg = JSON.stringify(data);

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
      client.send(msg);
    }
  });
}

wss.on("connection", socket => {
  socket.id = Math.random().toString(36).slice(2);
  socket.roomId = null;

  socket.on("message", msg => {
    try {
      const data = JSON.parse(msg);

      // Join room
      if (data.type === "join") {
        socket.roomId = data.room;

        if (!rooms[socket.roomId]) {
          rooms[socket.roomId] = makeRoom();
        }

        rooms[socket.roomId].players[socket.id] = { x: 0, y: 0 };

        socket.send(JSON.stringify({
          type: "settings",
          settings: rooms[socket.roomId].settings
        }));
      }

      // Player movement
      if (data.type === "move" && rooms[socket.roomId]) {
        rooms[socket.roomId].players[socket.id] = data.pos;

        broadcast(socket.roomId, {
          type: "players",
          players: rooms[socket.roomId].players
        });
      }

      // Host settings
      if (data.type === "settings" && rooms[socket.roomId]) {
        rooms[socket.roomId].settings = data.settings;

        broadcast(socket.roomId, {
          type: "settings",
          settings: data.settings
        });
      }

    } catch (e) {
      console.log("Bad message:", msg);
    }
  });

  socket.on("close", () => {
    if (socket.roomId && rooms[socket.roomId]) {
      delete rooms[socket.roomId].players[socket.id];

      broadcast(socket.roomId, {
        type: "players",
        players: rooms[socket.roomId].players
      });
    }
  });
});

console.log("Gravity Lab WebSocket server running on port", PORT);
