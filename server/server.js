const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config(); // 💥 Carrega as variáveis do arquivo .env no início do app

const app = express();
const server = http.createServer(app);

// 💥 Configura a origem do CORS e a porta através do .env ou usa valores padrão caso não existam
const corsOrigin = process.env.CORS_ORIGIN || "*";
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log("🔌 Usuário conectado:", socket.id);

  socket.on("join-room", ({ room, username }) => {
    socket.join(room);

    // Guardamos o nome dentro da sessão do socket para usar depois
    socket.username = username || "Anônimo"
    
    console.log(`📡 ${socket.id} entrou na sala ${room}`);
    // Notifica os usuários antigos da sala que um novo peer chegou
    socket.to(room).emit('user-connected', { id: socket.id, username: socket.username });
  });

  // Envia a oferta envelopando quem enviou (from)
  socket.on("offer", ({ offer, room, to = null }) => {
    console.log(`📤 Oferta de ${socket.id} para ${to || 'sala ' + room}`);
    if (to) {
      socket.to(to).emit("offer", { offer, from: socket.id, username: socket.username });
    } else {
      socket.to(room).emit("offer", { offer, from: socket.id, username: socket.username });
    }
  });

  // Envia a resposta envelopando quem respondeu (from)
  socket.on("answer", ({ answer, room, to = null }) => {
    console.log(`📩 Resposta de ${socket.id} para ${to || 'sala ' + room}`);
    if (to) {
      socket.to(to).emit("answer", { answer, from: socket.id, username: socket.username });
    } else {
      socket.to(room).emit("answer", { answer, from: socket.id, username: socket.username });
    }
  });

  // Envia o candidato ICE envelopando a origem (from)
  socket.on("candidate", ({ candidate, room, to = null }) => {
    console.log(`📡 Candidato de ${socket.id} para ${to || 'sala ' + room}`);
    if (to) {
      socket.to(to).emit("candidate", { candidate, from: socket.id, username: socket.username });
    } else {
      socket.to(room).emit("candidate", { candidate, from: socket.id, username: socket.username });
    }
  });

  socket.on("disconnecting", () => {
    console.log("❌ Usuário desconectando:", socket.id);
    // Avisa as salas que o usuário está saindo antes de limpar o socket
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit("user-disconnected", { id: socket.id, username: socket.username });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuário desconectado:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server rodando em ${process.env.SERVER_URL || `http://localhost:${PORT}`}`);
});