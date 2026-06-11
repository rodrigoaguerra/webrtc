// ─── Estado Global ──────────────────────────────────────────────────────────
let socket;
let pc;
let dataChannel;

// Fila de envio
let sendQueue = [];

// Fila de recebimento — indexed por id para O(1)
const receiveMap = new Map(); // id → entry
let receiveQueue = [];

// Chunks chegados antes do aceite, por id de arquivo
// null = arquivo já aceito (chunks vão direto); Array = aguardando aceite
const pendingChunksMap = new Map(); // id → ArrayBuffer[] | null

// Contadores de lote
let expectedFilesCount = 0;
let expectedTotalSize  = 0;
let receivedFilesCount = 0;
let sendFilesCount     = 0;
let sendFilesTotal    = 0;

// Modos de operação
let peerMode        = 'memory'; // modo local de recepção
let peerReceiveMode = 'memory'; // modo do peer remoto (para decisão de envio)

// ACK por arquivo: resolve quando receptor confirmar cada arquivo
const receivedAckResolvers = new Map(); // id → resolve

// Abort do lote de envio atual
let sendAbortController = null;

// Handle da pasta destino (File System Access API)
let targetDirHandle = null;

// ─── Constantes ─────────────────────────────────────────────────────────────
const MAX_FILE_SIZE     = 1024 * 1024 * 1024 * 1.5;  // 1.5 GB
const CHUNK_SIZE        = 250 * 1024;                // 250 KB
const BUFFER_HIGH_WATER = 4 * 1024 * 1024;           // 4 MB — pausa envio
const BUFFER_LOW_WATER  = 512 * 1024;                // 512 KB — retoma envio

// ─── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

// ─── Impedir suspensão do navegador ────────────────────────────────────────────────────────────────
let wakeLock = null;

async function requestWakeLock() {
  try {
    // Solicita o bloqueio de suspensão ao sistema
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      console.log('Wake Lock liberado');
    });
    log('💡 Modo de suspensão bloqueado para manter transferência ativa', 'info');
  } catch (err) {
    console.error(`Falha no Wake Lock: ${err.name}, ${err.message}`);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}

function log(msg, type = '') {
  const line = document.createElement('div');
  line.className = 'log-line';
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️', send: '📦', receive: '📥' };
  line.innerHTML = `
    <span class="log-time">${now()}</span>
    <span class="log-icon">${icons[type] || '·'}</span>
    <span class="log-msg ${type}">${msg}</span>`;
  $('log').prepend(line);
}

function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; }
function uid()        { return Math.random().toString(36).slice(2, 9); }

function setDot(id, state) {
  const d = $(`dot-${id}`);
  if (d) d.className = 'dot ' + state;
}

function createQueueItem(listEl, name, size) {
  const li = document.createElement('li');
  li.className = 'status-pending';
  li.innerHTML = `
    <span class="file-icon">📄</span>
    <span class="file-name" title="${name}">${name}</span>
    <span class="file-size">${fmtMB(size)}</span>
    <div class="file-progress-bar-wrap">
      <div class="file-progress-bar"></div>
    </div>`;
  listEl.appendChild(li);
  return li;
}

function setItemStatus(li, status) {
  li.className = `status-${status}`;
  const icons = { pending: '📄', active: '🔄', done: '✅', error: '❌' };
  li.querySelector('.file-icon').textContent = icons[status] ?? '📄';
}

function setItemSize(li, text) { li.querySelector('.file-size').textContent = text; }
function setItemProgress(li, p) { li.querySelector('.file-progress-bar').style.width = p + '%'; }

function updateProgress(entry) {
  const pct = Math.min(100, (entry.receivedSize / entry.meta.size) * 100).toFixed(1);
  setItemSize(entry.listItem, `${pct}% · ${fmtMB(entry.receivedSize)} de ${fmtMB(entry.meta.size)}`);
  setItemProgress(entry.listItem, pct);
}

function detectReceiveMode() {
  return typeof window.showDirectoryPicker === 'function' ? 'disk' : 'memory';
}

// ─── WebRTC config ───────────────────────────────────────────────────────────
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// ─── Conexão ─────────────────────────────────────────────────────────────────
async function connect() {
  const url  = $('srv').value.trim();
  const room = $('room').value.trim();

  socket = io(url, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  setDot('ws', 'yellow');
  log(`Conectando em ${url}…`, 'info');

  socket.on('connect', async () => {
    setDot('ws', 'green');
    log('Socket.IO conectado!', 'success');
    socket.emit('join-room', { room });
    setDot('room', 'green');
    log(`Entrou na sala "${room}"`, 'success');
    $('btn-connect').disabled = true;

    if(dataChannel && dataChannel.readyState === 'open') return;
    
    await initPeer(room);
  });

  socket.on('user-connected', async () => {
    log('Peer entrou na sala — iniciando offer…', 'info');
    dataChannel = pc.createDataChannel('file');
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannel();
    await createOffer(room);
  });

  socket.on('offer', async ({ offer }) => {
    log('Offer recebida — respondendo…', 'info');
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, room });
    } catch (err) { log(`Erro ao processar Offer: ${err.message}`, 'error'); }
  });

  socket.on('answer', async ({ answer }) => {
    try { await pc.setRemoteDescription(answer); }
    catch (err) { log(`Erro ao aplicar Answer: ${err.message}`, 'error'); }
  });

  socket.on('candidate', async ({ candidate }) => {
    if (pc && candidate) {
      try { await pc.addIceCandidate(candidate); }
      catch (err) { log(`Erro ICE: ${err.message}`, 'error'); }
    }
  });

  socket.on('disconnect', () => {
    setDot('ws', 'red'); setDot('room', 'red');
    log('Socket desconectado', 'error');
    $('btn-connect').disabled = false;
  });

  socket.on('reconnect', async () => {
    setDot('ws', 'green');
    socket.emit('join-room', { room });
    log(`Reconectado na sala "${room}"`, 'success');
    setDot('room', 'green');
    $('btn-connect').disabled = true;

    // Canal vivo? Só rejunta a sala, não toca no peer
    if (dataChannel && dataChannel.readyState === 'open') {
      log('Canal WebRTC ainda ativo — mantendo conexão', 'info');
      return;
    }

    // Canal morto: aí sim recria o peer
    await resetPeer(room);
  });

  socket.on('connect_error', () => {
    log('Erro de conexão', 'error');
    setDot('ws', 'red');
  });
}

// ─── Peer ────────────────────────────────────────────────────────────────────
async function initPeer(room) {
  pc = new RTCPeerConnection(rtcConfig);
  log('PeerConnection criada', 'info');

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannel();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('candidate', { candidate: e.candidate, room });
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    log(`Peer: ${s}`, 'info');
    if (s === 'connecting')                      setDot('peer', 'yellow');
    if (s === 'connected')                       setDot('peer', 'green');
    if (s === 'disconnected' || s === 'failed')  setDot('peer', 'red');
  };
}

async function resetPeer(room) {
  if (pc) { pc.close(); pc = null; }
  await initPeer(room);
}

async function createOffer(room) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { offer, room });
}

// ─── DataChannel ─────────────────────────────────────────────────────────────
function setupDataChannel() {
  dataChannel.onopen = () => {
    log('Canal aberto 🚀', 'success');
    $('fileInput').disabled  = false;
    $('folderInput').disabled = false;

    // Anuncia modo de recepção local ao peer
    const mode = detectReceiveMode();
    peerMode = mode;
    dataChannel.send(JSON.stringify({ type: 'receive-mode', mode }));
  };

  dataChannel.onclose = () => {
    log('Canal fechado', 'error');
    setDot('peer', 'red');
    $('fileInput').disabled  = true;
    $('folderInput').disabled = true;
    $('sendContainer').style.display = 'none';
    $('btn-send').disabled = true;
  };

  // Separação crítica: controle (síncrono) vs dados (async)
  dataChannel.onmessage = (event) => {
    if (typeof event.data === 'string') {
      handleControlMessage(JSON.parse(event.data)); // síncrono — nunca bloqueia a fila
    } else {
      handleChunk(event.data);                      // async — não aguardado intencionalmente
    }
  };
}

// ─── Mensagens de controle (síncrono) ────────────────────────────────────────
function handleControlMessage(msg) {
  switch (msg.type) {

    case 'receive-mode':
      peerReceiveMode = msg.mode;
      log(`Peer recebe em modo: ${peerReceiveMode}`, 'info');
      break;

    case 'offer-files':
      expectedFilesCount = msg.data.total;
      expectedTotalSize  = msg.data.size;
      receivedFilesCount = 0;
      $('received-files-count').innerText = receivedFilesCount + ' de ' + expectedFilesCount;
      log(`Lote de ${expectedFilesCount} arquivo(s) · ${fmtMB(expectedTotalSize)}`, 'send');
      
      if(peerMode === 'disk') {
        showAcceptTransfer();
      }
      
      break;

    case 'files-rejected':
      log(`Transferência rejeitada: ${msg.data.error}`, 'error');
      if (sendAbortController) {
        sendAbortController.abort();
        $('sendQueue').querySelectorAll('li').forEach(li => setItemStatus(li, 'error'));
        log('Envios interrompidos.', 'error');
      }
      releaseWakeLock(); // <--- LIBERAR O BLOQUEIO DE TELA
      break;

    case 'meta': {
      const meta = msg.data;
      if (meta.size > MAX_FILE_SIZE && peerMode === 'memory') {
        log(`❌ ${meta.name} grande demais para memória`, 'error');
        return;
      }
      $('emptyReceiveQueue').style.display = 'none';
      const li = createQueueItem($('receiveQueue'), meta.name, meta.size);
      const entry = {
        meta, id: meta.id, listItem: li,
        buffers: [], receivedSize: 0,
        isStreaming: false, writable: null,
        finalized: false,
        writeLock: Promise.resolve()
      };
      receiveMap.set(meta.id, entry);
      receiveQueue.push(entry);

      if (peerMode === 'memory') {
        // Modo memória: aceita imediatamente, chunks vão direto
        pendingChunksMap.set(meta.id, null); // null = aceito
      } else {
        // Modo disco: retém chunks até o usuário clicar Aceitar
        pendingChunksMap.set(meta.id, []);
      }
      break;
    }

    case 'received': {
      log(`✅ Recebido confirmado: ${msg.data.name}`, 'success');
      sendFilesCount++;
      $('send-files-count').innerText = `${sendFilesCount} de ${sendFilesTotal}`;
      const resolve = receivedAckResolvers.get(msg.data.id);
      if (resolve) {
        resolve();
        receivedAckResolvers.delete(msg.data.id);
      }
      break;
    }

    case 'finished' : {
      log(`Transferência concluida: ${fmtMB(msg.data.size)} foram enviados...`, 'success');
      $('send-files-count').innerText = `${sendFilesCount} de ${sendFilesTotal}`;
      releaseWakeLock(); // <--- LIBERAR O BLOQUEIO DE TELA
      break;
    }
  }
}

// ─── Chunks binários (async, não bloqueia onmessage) ────────────────────────
async function handleChunk(buf) {
  const view  = new DataView(buf);
  const idLen = view.getUint32(0, true);
  const idStr = new TextDecoder().decode(buf.slice(4, 4 + idLen));
  const chunk = buf.slice(4 + idLen);

  const entry = receiveMap.get(idStr);
  if (!entry) { console.warn(`Chunk para ID desconhecido: ${idStr}`); return; }

  const pending = pendingChunksMap.get(idStr);

  if (Array.isArray(pending)) {
    pending.push(chunk);
    return;
  }

  // Fila sequencial: Garante que os chunks sejam escritos um após o outro
  entry.writeLock = entry.writeLock.then(async () => {
    await writeChunk(entry, chunk);
    updateProgress(entry);
    if (!entry.finalized && entry.receivedSize >= entry.meta.size) {
      entry.finalized = true;
      await finalizeReceive(entry);
    }
  }).catch(err => log(`Erro interno no fluxo do chunk: ${err.message}`, 'error'));
}

// ─── Aceite de transferência ─────────────────────────────────────────────────
function showAcceptTransfer() {
  $('transferFileSize').innerText    = fmtMB(expectedTotalSize);
  $('acceptContainer').style.display = 'flex';
  $('receiveQueue').querySelectorAll('li').forEach(li => setItemStatus(li, 'pending'));
  log(`🔔 Aguardando aceite — ${fmtMB(expectedTotalSize)}`, 'warn');
}

async function acceptEntry() {
  await requestWakeLock(); // <--- ATIVAR O BLOQUEIO DE TELA
  
  const acceptBtn = $('btn-accept');
  acceptBtn.disabled  = true;
  acceptBtn.innerText = 'Processando...';
  
  
  // Pede pasta destino
  try {
    if (!targetDirHandle) {
      targetDirHandle = await window.showDirectoryPicker();
      log(`📁 Pasta destino: "${targetDirHandle.name}"`, 'info');
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
    log(`Erro ao abrir pasta: ${err.message}`, 'error');
    dataChannel.send(JSON.stringify({ type: 'files-rejected', data: { error: 'Pasta de destino não selecionada' } }));
    $('acceptContainer').style.display = 'none';
    acceptBtn.disabled  = false;
    acceptBtn.innerText = 'Aceitar e Salvar';
    return;
  }

  // ── Fase 1: Mapeia estrutura de pastas e handles sequencialmente ──────────
  for (const e of receiveQueue) {
    try {
      const parts    = (e.meta.relativePath || e.meta.name).split('/');
      const fileName = parts.pop();
      let dir = targetDirHandle;
      for (const part of parts) {
        if (part) dir = await dir.getDirectoryHandle(part, { create: true });
      }
      
      e.fileHandle = await dir.getFileHandle(fileName, { create: true });
      e.isStreaming = true;
      
    } catch (err) {
      e.isStreaming = false;
      log(`⚠️ "${e.meta.name}" em memória (${err.message})`, 'warn');
    }
  }

  // ── Fase 2: Oculta painel e libera o dreno inicial ────────────────────────
  $('acceptContainer').style.display = 'none';
  acceptBtn.disabled  = false;
  acceptBtn.innerText = 'Aceitar';

  for (const e of receiveQueue) {
    await drainAndFinalize(e);
  }
}

async function drainAndFinalize(e) {
  setItemStatus(e.listItem, 'active');

  const queued = pendingChunksMap.get(e.id) ?? [];
  
  // Enfileira o dreno inicial na Promise ANTES de liberar novos dados
  e.writeLock = e.writeLock.then(async () => {
    for (const chunk of queued) {
      await writeChunk(e, chunk);
    }
    
    if (e.receivedSize > 0) updateProgress(e);

    if (!e.finalized && e.receivedSize >= e.meta.size) {
      e.finalized = true;
      await finalizeReceive(e);
    }
  });

  // Somente agora sinalizamos que os novos chunks podem ir direto pro Lock
  pendingChunksMap.set(e.id, null); 
}

// ─── Escrita em disco ou memória ─────────────────────────────────────────────
async function writeChunk(entry, data) {
  if (entry.isStreaming) {
    try {
      // Lazy load: abre o fluxo de escrita apenas na chegada do primeiro chunk
      if (!entry.writable && entry.fileHandle) {
        entry.writable = await entry.fileHandle.createWritable();
      }
      await entry.writable.write(data);
    } catch (err) {
      log(`❌ Erro ao salvar chunk de "${entry.meta.name}"`, 'error');
    }
  } else {
    entry.buffers.push(data);
  }
  entry.receivedSize += data.byteLength;
}

// ─── Finalização de recepção ─────────────────────────────────────────────────
async function finalizeReceive(entry) {
  if (entry.isStreaming && entry.writable) {
    try {
      await entry.writable.close();
    } catch (err) {
      log(`❌ Erro ao fechar "${entry.meta.name}": ${err.message}`, 'error');
    }
    log(`${entry.meta.name} salvo em disco`, 'success');
  } else {
    const blob = new Blob(entry.buffers, { type: entry.meta.type || 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: entry.meta.relativePath || entry.meta.name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    entry.buffers = [];
    log(`${entry.meta.name} baixado`, 'receive');
  }

  setItemStatus(entry.listItem, 'done');
  setItemSize(entry.listItem, `(completo) ${fmtMB(entry.meta.size)}`);
  setItemProgress(entry.listItem, 100);

  // Confirma recebimento ao remetente
  dataChannel.send(JSON.stringify({ type: 'received', data: { name: entry.meta.name, id: entry.meta.id } }));

  receiveMap.delete(entry.meta.id);

  receivedFilesCount++;
  
  $('received-files-count').innerText = `${receivedFilesCount} de ${expectedFilesCount}`;

  if (expectedFilesCount > 0 && receivedFilesCount >= expectedFilesCount) {
    log(`🎉 Todos os ${expectedFilesCount} arquivos recebidos!`, 'success');
    dataChannel.send(JSON.stringify({ type: 'finished', data: { size: expectedFilesCount } }));
    targetDirHandle    = null;
    expectedFilesCount = 0;
    receivedFilesCount = 0;
    receiveQueue       = [];
  }
}

// ─── Envio ────────────────────────────────────────────────────────────────────
function offerFiles() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    log('⚠️ Canal ainda não está aberto', 'warn');
    return;
  }

  const files = [
    ...Array.from($('fileInput').files),
    ...Array.from($('folderInput').files)
  ];
  if (files.length === 0) return;

  $('emptySendQueue').style.display = 'none';
  $('sendContainer').style.display  = 'flex';
  $('sendFileSize').textContent     = fmtMB(files.reduce((a, b) => a + b.size, 0));

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      log(`❌ ${file.name} muito grande — pulado`, 'error');
      continue;
    }
    const li = createQueueItem($('sendQueue'), file.name, file.size);
    sendQueue.push({ file, id: uid(), listItem: li, relativePath: file.webkitRelativePath || file.name });
  }
}

async function sendFiles() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    log('⚠️ Canal ainda não está aberto', 'warn');
    return;
  }
  const toSend = [...sendQueue];
  sendQueue = [];
  if (toSend.length === 0) { log('⚠️ Nenhum arquivo na fila', 'warn'); return; }

  $('sendContainer').style.display = 'none';
  $('btn-send').disabled = true;

  sendAbortController = new AbortController();

  // 1. Envia a oferta de lote
  dataChannel.send(JSON.stringify({
    type: 'offer-files',
    data: { total: toSend.length, size: toSend.reduce((a, b) => a + b.file.size, 0) }
  }));


  sendFilesTotal = toSend.length; 
  $('send-files-count').textContent = sendFilesTotal;

  // 2. ADICIONE ESTE BLOCO: Envia a 'lista' de todos os arquivos de uma vez
  for (const item of toSend) {
    dataChannel.send(JSON.stringify({
      type: 'meta',
      data: {
        name: item.file.name,
        size: item.file.size,
        type: item.file.type,
        id: item.id,
        relativePath: item.relativePath
      }
    }));
  }

  // 3. Fluxo Sequencial: Processa um arquivo por vez de forma limpa
  
  await requestWakeLock(); // <--- ATIVAR O BLOQUEIO DE SUSPENÇÃO

  for (const file of toSend) {
    // Interrompe se o usuário cancelar o envio
    if (sendAbortController.signal.aborted) break;

    // Envia o arquivo e seus chunks
    await sendSingleFile(file, sendAbortController.signal);

    if (sendAbortController.signal.aborted) break;

    // Trava o loop até o receptor confirmar o salvamento (ACK)
    await new Promise((resolve) => {
      receivedAckResolvers.set(file.id, resolve);

      // Desbloqueia caso a conexão caia no meio da espera
      const onClose = () => {
        receivedAckResolvers.delete(file.id);
        resolve();
      };
      dataChannel.addEventListener('close', onClose, { once: true });
    });
  }

  // Desativa o bloqueio de suspensão
  await releaseWakeLock();

  // Limpa os inputs após finalizar a fila
  $('fileInput').value  = '';
  $('folderInput').value = '';
}

function sendSingleFile({ file, listItem, id, relativePath }, signal) {
  return new Promise((resolve) => {
    setItemStatus(listItem, 'active');
    log(`Enviando: ${file.name} (${fmtMB(file.size)})`, 'send');

    let offset = 0;
    const reader = new FileReader();

    const sendNextChunk = async () => {
      if (signal.aborted) {
        setItemStatus(listItem, 'error');
        setItemSize(listItem, '(cancelado)');
        resolve();
        return;
      }

      if (offset >= file.size) {
        setItemStatus(listItem, 'done');
        setItemSize(listItem, `(completo) ${fmtMB(file.size)}`);
        setItemProgress(listItem, 100);
        log(`${file.name} enviado`, 'send');
        resolve();
        return;
      }

      // Backpressure: espera o buffer do canal esvaziar
      if (dataChannel.bufferedAmount > BUFFER_HIGH_WATER) {
        await waitForBufferDrain();
      }

      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
    };

    reader.onload = async (e) => {
      if (signal.aborted) { resolve(); return; }

      const raw = e.target.result;

      // Monta pacote: [4 bytes idLen LE][id UTF-8][dados]
      const idBytes = new TextEncoder().encode(id);
      const header  = new ArrayBuffer(4);
      new DataView(header).setUint32(0, idBytes.length, true);
      const buf = await new Blob([header, idBytes, raw]).arrayBuffer();
      dataChannel.send(buf);

      offset += raw.byteLength;
      const pct = ((offset / file.size) * 100).toFixed(1);
      setItemSize(listItem, `${pct}% · ${fmtMB(offset)} de ${fmtMB(file.size)}`);
      setItemProgress(listItem, pct);
      sendNextChunk();
    };

    reader.onerror = () => {
      setItemStatus(listItem, 'error');
      log(`❌ Erro ao ler ${file.name}`, 'error');
      resolve();
    };

    sendNextChunk();
  });
}

// Aguarda o bufferedAmount cair abaixo do limiar — usando bufferedamountlow
function waitForBufferDrain() {
  return new Promise((resolve) => {
    if (dataChannel.bufferedAmount <= BUFFER_LOW_WATER) { resolve(); return; }
    dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    dataChannel.addEventListener('bufferedamountlow', resolve, { once: true });
  });
}

// ─── Beforeunload ─────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  const enviando  = sendQueue.length > 0;
  const recebendo = receiveQueue.some(en => en.receivedSize < en.meta?.size);
  if (enviando || recebendo) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ─── Bindings ─────────────────────────────────────────────────────────────────
$('btn-connect') .addEventListener('click', connect);
$('fileInput')   .addEventListener('change', offerFiles);
$('folderInput') .addEventListener('change', offerFiles);
$('btn-send')    .addEventListener('click', sendFiles);
$('btn-accept')  .addEventListener('click', acceptEntry);

log('Pronto. Configure o servidor e clique em Conectar.', 'info');
