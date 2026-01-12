const WebSocket = require("ws");
const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

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

server.on("connection", socket => {
  let roomId = null;
  let playerId = Math.random().toString(36).slice(2);

  socket.on("message", msg => {
    try {
      let data = JSON.parse(msg);

      // Join room
      if (data.type === "join") {
        roomId = data.room;

        if (!rooms[roomId]) rooms[roomId] = makeRoom();
        rooms[roomId].players[playerId] = { x: 0, y: 0 };

        socket.send(JSON.stringify({
          type: "settings",
          settings: rooms[roomId].settings
        }));
      }

      // Player move
      if (data.type === "move" && rooms[roomId]) {
        rooms[roomId].players[playerId] = data.pos;

        broadcast(roomId, {
          type: "players",
          players: rooms[roomId].players
        });
      }

      // Host settings
      if (data.type === "settings" && rooms[roomId]) {
        rooms[roomId].settings = data.settings;
        broadcast(roomId, {
          type: "settings",
          settings: data.settings
        });
      }

    } catch (e) {}
  });

  socket.on("close", () => {
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[playerId];
    }
  });
});

function broadcast(room, data) {
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

console.log("Gravity Lab server running");
