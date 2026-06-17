// ─── Estado Global Multi-Peer ───────────────────────────────────────────────
let socket;
const peers = {};         // { socketId: RTCPeerConnection }
const dataChannels = {};  // { socketId: RTCDataChannel }
let myRoom = '';
const peerNames = {}; // { socketId: "Nome do Usuário" }

// ─── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

function log(msg, type = '') {
  const line = document.createElement('div');
  line.className = 'log-line';
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
  line.innerHTML = `
    <span class="log-time">${now()}</span>
    <span class="log-icon">${icons[type] || '·'}</span>
    <span class="log-msg ${type}">${msg}</span>`;
  $('log').appendChild(line);
  $('log').scrollTop = 9999;
}

function setDot(id, state) {
  const d = $(`dot-${id}`);
  if (d) d.className = 'dot ' + state;
}

function updatePeerStatusDot() {
  const activePeers = Object.keys(dataChannels).filter(id => dataChannels[id].readyState === 'open').length;
  if (activePeers > 0) {
    setDot('peer', 'green');
    log(`Conectado a ${activePeers} participante(s) no grupo`, 'info');
  } else {
    setDot('peer', 'yellow');
  }
}

// ─── Adicionar Mensagem na UI ────────────────────────────────────────────────
function appendMessage(text, sender, senderName = 'Alguém') {
  const container = $('messageContainer');
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${sender}`; // 'me' ou 'peer'
  
  msgEl.innerHTML = `
    <div class="chat-bubble">
      <span class="chat-sender-name">${senderName}</span>
      <p class="chat-text"></p>
      <span class="chat-time">${now()}</span>
    </div>
  `;
  
  msgEl.querySelector('.chat-text').textContent = text;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

// ─── WebRTC config ───────────────────────────────────────────────────────────
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// ─── Conexão Socket.IO ───────────────────────────────────────────────────────
async function connect() {
  const url  = $('srv').value.trim();
  const myName = $('username').value.trim() || "Anônimo"; // Pega o nome do input
  myRoom = $('room').value.trim();

  socket = io(url, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });

  setDot('ws', 'yellow');
  log(`Conectando ao sinalizador...`, 'info');

  socket.on('connect', () => {
    setDot('ws', 'green');
    log('Conectado ao servidor de sinalização!', 'success');
    
    // 💥 ENVIANDO O NOME E A SALA PARA O BACKEND
    socket.emit('join-room', { room: myRoom, username: myName });
    
    setDot('room', 'green');
    log(`Você entrou como "${myName}" no grupo: "${myRoom}"`, 'success');
    $('btn-connect').disabled = true;
    $('username').disabled = true; // Bloqueia o input de nome após conectar
    enableInputBox();
  });

  // 1. Um novo usuário se conectou (Modificado para receber objeto)
  socket.on('user-connected', async ({ id, username }) => {
    peerNames[id] = username; // Salva o nome dele associado ao ID
    log(`${username} entrou no grupo. Criando conexão direta...`, 'info');
    await initPeer(id, true); 
  });

  // 2. Recebendo oferta (Modificado para ler o nome)
  socket.on('offer', async ({ offer, from, username }) => {
    if (!offer) return;
    peerNames[from] = username; // Garante que salvou o nome de quem ofertou
    log(`Conectando de forma direta com ${username}...`, 'info');
    
    const pc = await initPeer(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, to: from, room: myRoom });
    } catch (err) { log(`Erro ao responder oferta: ${err.message}`, 'error'); }
  });

  // 3. Recebendo resposta (Modificado para ler o nome se necessário)
  socket.on('answer', async ({ answer, from, username }) => {
    if(username) peerNames[from] = username;
    const pc = peers[from];
    if (pc && answer) {
      try { await pc.setRemoteDescription(answer); }
      catch (err) { log(`Erro ao aplicar resposta: ${err.message}`, 'error'); }
    }
  });

  // 4. Recebendo candidatos ICE (Mantém igual)
  socket.on('candidate', async ({ candidate, from }) => {
    const pc = peers[from];
    if (pc && candidate) {
      try { await pc.addIceCandidate(candidate); }
      catch (err) { console.error(`Erro ICE:`, err); }
    }
  });

  // 5. Usuário saiu do grupo (Modificado para ler o objeto)
  socket.on('user-disconnected', ({ id, username }) => {
    log(`${username || 'Um participante'} saiu do grupo.`, 'warn');
    closePeerConnection(id);
    delete peerNames[id]; // Limpa o nome da memória
  });

  socket.on('disconnect', () => {
    setDot('ws', 'red'); setDot('room', 'red'); setDot('peer', 'red');
    log('Você foi desconectado.', 'error');
    $('btn-connect').disabled = false;
    $('username').disabled = false;
    disableChat();
    Object.keys(peers).forEach(closePeerConnection);
  });
}

// ─── Gerenciamento de Conexões WebRTC (Multi-Peer) ──────────────────────────
async function initPeer(userId, isInitiator) {
  // Se já existe uma conexão para este ID, encerra antes de refazer
  if (peers[userId]) closePeerConnection(userId);

  const pc = new RTCPeerConnection(rtcConfig);
  peers[userId] = pc;

  if (isInitiator) {
    // Se fomos nós que iniciamos, criamos o canal de dados nele
    const dc = pc.createDataChannel('chat-group');
    setupDataChannel(userId, dc);
  } else {
    // Se estamos respondendo, esperamos o canal vir dele
    pc.ondatachannel = (event) => {
      setupDataChannel(userId, event.channel);
    };
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('candidate', { candidate: e.candidate, to: userId });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      closePeerConnection(userId);
    }
  };

  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { offer, to: userId });
    } catch (err) { log(`Erro ao criar oferta para ${userId}`, 'error'); }
  }

  return pc;
}

function setupDataChannel(userId, channel) {
  dataChannels[userId] = channel;

  channel.onopen = () => {
    log(`Conexão direta P2P estabelecida com ${userId} 🚀`, 'success');
    updatePeerStatusDot();
    enableChatButton();
  };

  channel.onclose = () => {
    closePeerConnection(userId);
  };

  channel.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'text') {
        // 💥 PEGA O NOME REAL SALVO NO NOSSO MAPA, se não achar usa "Membro do Grupo"
        const senderRealName = peerNames[userId] || "Membro do Grupo";
        appendMessage(msg.data, 'peer', senderRealName);
      }
    } catch (e) { console.error(e); }
  };
}

function closePeerConnection(userId) {
  if (dataChannels[userId]) {
    dataChannels[userId].close();
    delete dataChannels[userId];
  }
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  updatePeerStatusDot();
  if (Object.keys(dataChannels).length === 0) {
    disableChatButtonOnly();
  }
}

// ─── Lógica de Envio em Grupo ───────────────────────────────────────────────
function enableInputBox() {
  $('messageInput').disabled = false;
  $('messageInput').focus();
}

function enableChatButton() {
  $('btn-send').disabled = false;
}

function disableChatButtonOnly() {
  $('btn-send').disabled = true;
}

function disableChat() {
  $('messageInput').disabled = true;
  $('btn-send').disabled = true;
}

function sendMessage() {
  const input = $('messageInput');
  const text = input.value.trim();
  if (!text) return;

  const msgPacket = { type: 'text', data: text };
  const dacString = JSON.stringify(msgPacket);
  
  let sentCount = 0;

  // 💥 O SEGREDO DO GRUPO: Varre todos os canais abertos e envia a mensagem para cada um deles
  Object.keys(dataChannels).forEach(userId => {
    const dc = dataChannels[userId];
    if (dc && dc.readyState === 'open') {
      dc.send(dacString);
      sentCount++;
    }
  });

  // Renderiza a sua própria mensagem na tela
  appendMessage(text, 'me', 'Você');
  
  input.value = '';
  input.focus();

  if(sentCount === 0) {
    log('Sua mensagem foi renderizada localmente, mas não há outros peers conectados na malha para recebê-la.', 'warn');
  }
}

// Bindings de Eventos
$('btn-send').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
$('btn-connect').addEventListener('click', connect);

log('Pronto para conexões em grupo. Configure o servidor e conecte-se.', 'info');