// ─── Estado Global Multi-Peer ───────────────────────────────────────────────
let socket;
const peers = {};         // { socketId: RTCPeerConnection }
const dataChannels = {};  // { socketId: RTCDataChannel }
let myRoom = '';
const peerNames = {}; // { socketId: "Nome do Usuário" }

// ─── Estado Global de Transferência ─────────────────────────────────────────
const CHUNK_SIZE = 64 * 1024; // 64KB por chunk
const fileTransfers = {}; // { transferId: { chunks, received, total, name, type, size } }

// ─── Estado Global de Gravação ──────────────────────────────────────────────
let mediaRecorder  = null;
let recChunks      = [];
let recStream      = null;
let recTimerInterval = null;
let recSeconds     = 0;

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
    // Mensagem de controle (JSON)
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'text') {
          const senderRealName = peerNames[userId] || "Membro do Grupo";
          appendMessage(msg.data, 'peer', senderRealName);
        }

        if (msg.type === 'file-start') {
          // Inicia recepção de um arquivo
          fileTransfers[msg.transferId] = {
            chunks: [],
            received: 0,
            total: msg.size,
            name: msg.name,
            mimeType: msg.mimeType,
            senderId: userId
          };
          log(`Recebendo "${msg.name}" de ${peerNames[userId] || userId}...`, 'info');
        }

        if (msg.type === 'file-end') {
          const transfer = fileTransfers[msg.transferId];
          if (!transfer) return;

          const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
          const senderName = peerNames[transfer.senderId] || "Membro do Grupo";
          appendFile(blob, transfer.name, transfer.mimeType, senderName);
          log(`"${transfer.name}" recebido com sucesso!`, 'success');
          delete fileTransfers[msg.transferId];
        }

      } catch (e) { console.error(e); }

    } else {
      // Chunk binário (ArrayBuffer)
      // Identifica a qual transferência pertence pelo primeiro transferId ativo deste peer
      const activeTransfer = Object.values(fileTransfers).find(t => t.senderId === userId);
      if (activeTransfer) {
        activeTransfer.chunks.push(event.data);
        activeTransfer.received += event.data.byteLength;
      }
    }
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
  $('btn-attachements').disabled = false;
  $('fileInput').disabled = false;
  $('btn-rec-audio').disabled   = false;
  $('btn-rec-video').disabled   = false;
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
  $('btn-attachements').disabled = true;
  $('fileInput').disabled = true;
  $('btn-rec-audio').disabled   = true;
  $('btn-rec-video').disabled   = true;
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

// ─── Lógica de Envio de Arquivos ──────────────────────────────────────────────────────

function appendFile(blob, fileName, mimeType, senderName) {
  const container = $('messageContainer');
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${senderName === 'Você' ? 'me' : 'peer'}`;

  const url = URL.createObjectURL(blob);
  let mediaHtml = '';

  if (mimeType.startsWith('image/')) {
    mediaHtml = `<img src="${url}" alt="${fileName}" style="max-width:220px; max-height:200px; border-radius:8px; display:block; margin-top:6px; cursor:pointer;" onclick="window.open(this.src)">`;
  } else if (mimeType.startsWith('video/')) {
    mediaHtml = `<video src="${url}" controls style="max-width:260px; border-radius:8px; display:block; margin-top:6px;"></video>`;
  } else if (mimeType.startsWith('audio/')) { 
    mediaHtml = `<audio src="${url}" controls style="max-width:260px; border-radius:8px; display:block; margin-top:6px;"></audio>`; 
  } else {
    mediaHtml = `<a href="${url}" download="${fileName}" style="color:#7eb8f7;">📥 ${fileName}</a>`;
  }

  msgEl.innerHTML = `
    <div class="chat-bubble">
      <span class="chat-sender-name">${senderName}</span>
      ${mediaHtml}
      <span class="chat-file-name" style="font-size:11px; opacity:0.6; display:block; margin-top:4px;">${fileName}</span>
      <span class="chat-time">${now()}</span>
    </div>`;

  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

async function sendFile(file) {
  const transferId = crypto.randomUUID();
  const arrayBuffer = await file.arrayBuffer();
  const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

  const startMsg = JSON.stringify({
    type: 'file-start',
    transferId,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    totalChunks
  });

  const endMsg = JSON.stringify({ type: 'file-end', transferId });

  // Envia para todos os peers abertos
  const openChannels = Object.values(dataChannels).filter(dc => dc.readyState === 'open');
  if (openChannels.length === 0) {
    log('Nenhum peer conectado para receber o arquivo.', 'warn');
    return;
  }

  log(`Enviando "${file.name}" (${(file.size / 1024).toFixed(1)} KB)...`, 'info');

  for (const dc of openChannels) {
    dc.send(startMsg);
    for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      // Aguarda o buffer esvaziar se estiver cheio (backpressure)
      while (dc.bufferedAmount > 1 * 1024 * 1024) {
        await new Promise(r => setTimeout(r, 20));
      }
      dc.send(chunk);
    }
    dc.send(endMsg);
  }

  // Renderiza localmente também
  const blob = new Blob([arrayBuffer], { type: file.type });
  appendFile(blob, file.name, file.type, 'Você');
  log(`"${file.name}" enviado!`, 'success');
}

// ─── Gravação de Áudio / Vídeo ───────────────────────────────────────────────
function showRecIndicator(label) {
  recSeconds = 0;
  $('rec-label').textContent = label + ' · 0s';
  $('rec-indicator').style.display = 'flex';
  recTimerInterval = setInterval(() => {
    recSeconds++;
    $('rec-label').textContent = label + ` · ${recSeconds}s`;
  }, 1000);
}

function hideRecIndicator() {
  $('rec-indicator').style.display = 'none';
  clearInterval(recTimerInterval);
}

async function startRecording(mode) {
  // mode = 'audio' | 'video'
  try {
    recStream = await navigator.mediaDevices.getUserMedia(
      mode === 'video'
        ? { video: true, audio: true }
        : { audio: true }
    );
  } catch (err) {
    log(`Erro ao acessar mídia: ${err.message}`, 'error');
    return;
  }

  recChunks = [];

  // Escolhe o melhor codec disponível
  const mimeType = mode === 'video'
    ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm')
    : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/ogg');

  mediaRecorder = new MediaRecorder(recStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    recStream.getTracks().forEach(t => t.stop());
    hideRecIndicator();

    const blob     = new Blob(recChunks, { type: mimeType });
    const ext      = mode === 'video' ? 'webm' : 'webm';
    const fileName = `${mode}-${Date.now()}.${ext}`;

    // Mostra localmente
    appendFile(blob, fileName, mimeType, 'Você');

    // Envia para os peers
    const openChannels = Object.values(dataChannels).filter(dc => dc.readyState === 'open');
    if (openChannels.length === 0) {
      log('Gravação salva localmente — nenhum peer conectado.', 'warn');
      return;
    }

    log(`Enviando ${mode === 'video' ? 'vídeo' : 'áudio'} gravado...`, 'info');
    const arrayBuffer = await blob.arrayBuffer();
    const transferId  = crypto.randomUUID();

    const startMsg = JSON.stringify({
      type: 'file-start', transferId,
      name: fileName, mimeType, size: blob.size
    });
    const endMsg = JSON.stringify({ type: 'file-end', transferId });

    for (const dc of openChannels) {
      dc.send(startMsg);
      for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
        while (dc.bufferedAmount > 1 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 20));
        }
        dc.send(arrayBuffer.slice(offset, offset + CHUNK_SIZE));
      }
      dc.send(endMsg);
    }
    log(`${mode === 'video' ? 'Vídeo' : 'Áudio'} enviado!`, 'success');
  };

  mediaRecorder.start(100); // coleta chunks a cada 100ms
  showRecIndicator(mode === 'video' ? '🎥 Gravando vídeo' : '🎤 Gravando áudio');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// Bindings de Eventos
$('btn-connect').addEventListener('click', connect);

// Mensagens
$('btn-send').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// Arquivos 
$('btn-attachements').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    await sendFile(file);
  }
  e.target.value = ''; // limpa seleção para poder enviar o mesmo arquivo de novo
});

// Gravar Áudio — segurar para gravar
$('btn-rec-audio').addEventListener('pointerdown',  () => startRecording('audio'));
$('btn-rec-audio').addEventListener('pointerup',    stopRecording);
$('btn-rec-audio').addEventListener('pointercancel',   stopRecording);
$('btn-rec-audio').addEventListener('pointerleave', stopRecording);

// Gravar Vídeo — segurar para gravar
$('btn-rec-video').addEventListener('pointerdown',  () => startRecording('video'));
$('btn-rec-video').addEventListener('pointerup',    stopRecording);
$('btn-rec-video').addEventListener('pointercancel', stopRecording);
$('btn-rec-video').addEventListener('pointerleave',   stopRecording);

log('Pronto para conexões em grupo. Configure o servidor e conecte-se.', 'info');