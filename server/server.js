const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config(); // 💥 Carrega as variáveis do arquivo .env no início do app

const app = express();
const server = http.createServer(app);

// 💥 Configura a origem do CORS e a porta através do .env ou usa valores padrão caso não existam
const corsOrigin = process.env.CORS_ORIGIN || "*";
const PORT = process.env.PORT || 3000

// Rota que o ping vai chamar
app.get('/ping', (req, res) => res.send('pong'));

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log("🔌 Usuário conectado:", socket.id);

  // Agora recebe um objeto com o nome e a sala
  socket.on("join-room", ({ room, username }) => {
    socket.join(room);
    
    // Guardamos o nome dentro da sessão do socket para usar depois
    socket.username = username || "Anônimo";
    
    console.log(`📡 ${socket.username} (${socket.id}) entrou na sala ${room}`);
    
    // Avisa os antigos que o novo peer chegou, passando o ID E o Nome dele
    socket.to(room).emit('user-connected', { id: socket.id, username: socket.username });
  });

  // Modificado para passar o "username" de quem está mandando a oferta
  socket.on("offer", ({ offer, room, to = null }) => {
    console.log(`📡 (${socket.id}) enviou oferta para ${to || room}`);
    if (to) {
      socket.to(to).emit("offer", { offer, from: socket.id, username: socket.username });
    } else {
      socket.to(room).emit("offer", { offer, from: socket.id, username: socket.username });
    }
  });

  // Modificado para passar o "username" de quem está respondendo
  socket.on("answer", ({ answer, room, to = null }) => {
    console.log(`📡 (${socket.id}) enviou resposta para ${to || room}`);
    if (to) {
      socket.to(to).emit("answer", { answer, from: socket.id, username: socket.username });
    } else {
      socket.to(room).emit("answer", { answer, from: socket.id, username: socket.username });
    }
  });

  socket.on("candidate", ({ candidate, room, to = null }) => {
    console.log(`📡 (${socket.id}) enviou candidato para ${to || room}`);
    if (to) {
      socket.to(to).emit("candidate", { candidate, from: socket.id });
    } else {
      socket.to(room).emit("candidate", { candidate, from: socket.id });
    }
  });

  socket.on("disconnecting", () => {
    console.log("📡 Usuário desconectando:", socket.id);
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        // Passa o nome de quem saiu para o log do grupo ficar bonito
        socket.to(room).emit("user-disconnected", { id: socket.id, username: socket.username });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuário desconectado:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server rodando em ${ process.env.SERVER_URL || 'http://localhost:' + PORT }`);
});