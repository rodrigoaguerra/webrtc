const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

io.on("connection", (socket) => {
  console.log("🔌 Usuário conectado:", socket.id);

  socket.on("join-room", (room) => {
    socket.join(room);
    console.log(`📡 ${socket.id} entrou na sala ${room}`);
  });

  socket.on("offer", ({ offer, room }) => {
    socket.to(room).emit("offer", offer);
  });

  socket.on("answer", ({ answer, room }) => {
    socket.to(room).emit("answer", answer);
  });

  socket.on("candidate", ({ candidate, room }) => {
    socket.to(room).emit("candidate", candidate);
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuário desconectado:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Server rodando em http://localhost:3000");
});