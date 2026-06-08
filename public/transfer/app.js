// ─── Estado Global ──────────────────────────────────────────────────────────
let socket;
let pc;
let dataChannel;

// Fila de envio
let sendQueue = [];

// Fila de recebimento
let receiveQueue = []; // { meta, id, listItem, buffers, receivedSize, isStreaming, writable }

// Fila de aceite (um painel por vez)
let acceptQueue   = []; // entradas aguardando aceite do usuário
let isAccepting   = false; // true enquanto o painel está visível

// Chunks chegados antes do aceite, por id de arquivo
let pendingChunksMap = {}; // { [id]: ArrayBuffer[] }

// Quantos arquivos o remetente disse que vai enviar
let expectedFilesCount = 0;
// Tamanho total esperado dos arquivos
let expectedTotalSize = 0;
// Quantos arquivos já foram totalmente recebidos
let receivedFilesCount = 0;

// Controlador de abortos para envios em andamento, caso o remetente rejeite os arquivos
let sendAbortController = null;

// ─── Constantes ─────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 1024 * 1024 * 1024 + 512; // 1.5 GB
// Alterado de 256 KB para 250 KB para dar espaço aos metadados do pacote binário
const CHUNK_SIZE    = 250 * 1024;          // 250 KB

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

function setItemSize(li, text)  { li.querySelector('.file-size').textContent = text; }
function setItemProgress(li, p) { li.querySelector('.file-progress-bar').style.width = p + '%'; }

function updateProgress(entry) {
  const pct = ((entry.receivedSize / entry.meta.size) * 100).toFixed(1);
  setItemSize(entry.listItem, `${pct}% · ${fmtMB(entry.receivedSize)} de ${fmtMB(entry.meta.size)}`);
  setItemProgress(entry.listItem, pct);
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

  socket = io(url, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

  setDot('ws', 'yellow');
  log(`Conectando em ${url}…`, 'info');

  socket.on('connect', async () => {
    setDot('ws', 'green');
    log('Socket.IO conectado!', 'success');
    socket.emit('join-room', { room });
    setDot('room', 'green');
    log(`Entrou na sala "${room}"`, 'success');
    $('btn-connect').disabled = true;

    // Inicializa o Peer, mas NÃO chama createOffer automaticamente lá dentro
    await initPeer(room);
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
    setDot('room', 'green');
    $('btn-connect').disabled = true;
    await resetPeer(room);
  });

  socket.on('connect_error', () => {
    log('Erro de conexão', 'error');
    setDot('ws', 'red');
  });
}

// ─── Peer ─────────────────────────────────────────────────────────────────────
async function initPeer(room) {
  pc = new RTCPeerConnection(rtcConfig);
  setDot('peer', 'yellow');
  log('PeerConnection criada', 'info');

  dataChannel = pc.createDataChannel('file');
  dataChannel.binaryType = 'arraybuffer';
  setupDataChannel();

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannel();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('candidate', { candidate: e.candidate, room });
  };

  pc.onconnectionstatechange = () => {
    log(`Peer: ${pc.connectionState}`, 'info');
    if (pc.connectionState === 'connected')                              setDot('peer', 'green');
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setDot('peer', 'red');
  };

  createOffer(room);
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

// ─── DataChannel ──────────────────────────────────────────────────────────────
function setupDataChannel() {
  dataChannel.onopen = () => {
    log('Canal aberto 🚀', 'success');
    
    setDot('peer', 'green');
    
    $('fileInput').disabled = false;
    $('btn-send').disabled  = false;
  };

  dataChannel.onclose = () => {
    log('Canal fechado', 'error');
    setDot('peer', 'red');
    $('fileInput').disabled = true;
    $('btn-send').disabled  = true;
  };

  dataChannel.onmessage = async (event) => {
    // ── Texto: meta ou confirmação ──────────────────────────────────────────
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);

      if (msg.type === 'offer-files') {
        expectedFilesCount = msg.data.total;
        expectedTotalSize = msg.data.size;
        receivedFilesCount = 0; // Reseta para o novo lote de envios
        log(`📦 Um novo lote de ${expectedFilesCount} arquivo(s) com ${fmtMB(expectedTotalSize)} está sendo enviado...`, 'info');
        return;
      }

      if(msg.type === 'files-rejected') {
        log(`O remetente rejeitou os arquivos: ${msg.data.error}`, 'error');
        log('O remetente pode ter rejeitado os arquivos por serem grandes demais para processar em memória. Considere usar um navegador moderno com suporte a File System Access API para salvar diretamente em disco.', 'warn');
        
        // 🟥 Cancela imediatamente todos os envios em andamento
        if (sendAbortController) {
          sendAbortController.abort();
          log('🛑 Todos os envios ativos foram interrompidos localmente.', 'error');
        }
        return;
      }

      if (msg.type === 'meta') {
        const meta = msg.data;
        if (meta.size > MAX_FILE_SIZE) {
          log(`❌ ${meta.name} muito grande (máx 1 GB)`, 'error');
          return;
        }

        $('receiveQueueContainer').style.display = '';
        const li = createQueueItem($('receiveQueue'), meta.name, meta.size);

        const entry = {
          meta, id: meta.id, listItem: li,
          buffers: [], receivedSize: 0, isStreaming: false, writable: null
        };
        receiveQueue.push(entry);

        // Reserva slot de chunks pendentes para este arquivo
        pendingChunksMap[meta.id] = [];

        // Enfileira para aceite e exibe se não houver nenhum aberto
        acceptQueue.push(entry);
        showNextAccept();
        return;
      }

      if (msg.type === 'received') {
        log('✅ Destinatário confirmou recebimento', 'success');
      }
      return;
    }

    // ── Binário: chunk ──────────────────────────────────────────────────────
    // Formato: [Uint32 idLen][id UTF-8][dados]
    const buf   = event.data;
    const view  = new DataView(buf);
    
    // Passamos 'true' como segundo parâmetro para ler em Little-Endian igual ao envio
    const idLen = view.getUint32(0, true); 
    
    const idStr = new TextDecoder().decode(buf.slice(4, 4 + idLen));
    const chunk = buf.slice(4 + idLen);

    const entry = receiveQueue.find(e => e.meta.id === idStr);
    if (!entry) {
      console.warn(`Recebido chunk para ID desconhecido ou não inicializado: ${idStr}`);
      return;
    }

    // Se este arquivo ainda aguarda aceite, guarda o chunk
    if (pendingChunksMap[idStr]) {
      pendingChunksMap[idStr].push(chunk);
      return;
    }

    // Arquivo já aceito — escreve direto
    await writeChunk(entry, chunk);
    updateProgress(entry);
    if (entry.receivedSize >= entry.meta.size) await finalizeReceive(entry);
  };
}

// ─── Fila de aceite ───────────────────────────────────────────────────────────
function showNextAccept() {
  if (isAccepting || acceptQueue.length === 0) return;
  isAccepting = true;

  const entry  = acceptQueue[0]; // não remove ainda — remove ao clicar Aceitar
  const sizeMB = fmtMB(entry.meta.size);
  log(`🔔 ${entry.meta.name} (${sizeMB}) aguardando aceite...`, 'warn');
  $('transferFileName').innerText    = entry.meta.name;
  $('transferFileSize').innerText    = sizeMB;
  $('acceptContainer').style.display = 'block';
  setItemStatus(entry.listItem, 'pending');
}

$('acceptBtn').addEventListener('click', async () => {
  if (acceptQueue.length === 0) return;

  const acceptBtn = $('acceptBtn');
  acceptBtn.disabled  = true;
  acceptBtn.innerText = 'Processando...';

  const entry = acceptQueue.shift();
  setItemStatus(entry.listItem, 'active');

  // Abre pickers para TODOS os arquivos pendentes na fila de uma vez
  const allEntries = [entry, ...acceptQueue];
  acceptQueue = []; // esvazia — todos serão tratados agora

  for (const e of allEntries) {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: e.meta.name,
          types: [{ description: 'Arquivo', accept: { [e.meta.type || 'application/octet-stream']: [] } }]
        });
        e.writable   = await handle.createWritable();
        e.isStreaming = true;
        log(`💾 Salvando "${e.meta.name}" em disco`, 'info');
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
        e.isStreaming = false;
        log(`⚠️ "${e.meta.name}" ficará em memória (picker cancelado)`, 'warn');
      }
    } else {
      e.isStreaming = false;
      log(`⚠️ "${e.meta.name}" ficará em memória (sem picker)`, 'warn');
      if (expectedTotalSize > MAX_FILE_SIZE) {
        log('Tamanho total de arquivos grande demais para ser processado em memória', 'warn');
        log('Considere usar um navegador moderno com suporte a File System Access API para salvar diretamente em disco', 'warn');
        log('Por enquanto, este arquivo será ignorado para evitar travar o navegador', 'warn');
        dataChannel.send(JSON.stringify({ type: 'files-rejected', data: { error: 'Tamanho de arquivos muito grande, para salvar em memória' } }));
        continue;
      }
    }

    // Drena chunks pendentes para cada arquivo
    const queued = pendingChunksMap[e.id] ?? [];
    delete pendingChunksMap[e.id];
    for (const chunk of queued) await writeChunk(e, chunk);
    if (e.receivedSize > 0) updateProgress(e);
    if (e.receivedSize >= e.meta.size) await finalizeReceive(e);
  }

  $('acceptContainer').style.display = 'none';
  isAccepting = false;
  acceptBtn.disabled  = false;
  acceptBtn.innerText = 'Aceitar';
  // Não chama showNextAccept — já processamos tudo
});

// ─── Escrita / finalização ────────────────────────────────────────────────────
async function writeChunk(entry, data) {
  if (entry.isStreaming && entry.writable) {
    try { await entry.writable.write(data); }
    catch (err) { log('❌ Erro ao salvar chunk em disco', 'error'); }
  } else {
    entry.buffers.push(data);
  }
  entry.receivedSize += data.byteLength;
}

async function finalizeReceive(entry) {
  if (entry.isStreaming && entry.writable) {
    await entry.writable.close();
    log(`✅ ${entry.meta.name} salvo em disco`, 'success');
  } else {
    log(`✅ ${entry.meta.name} recebido (memória)`, 'success');
  }
  setItemStatus(entry.listItem, 'done');
  setItemSize(entry.listItem, `(completo) ${fmtMB(entry.meta.size)}`);
  setItemProgress(entry.listItem, 100);
  dataChannel.send(JSON.stringify({ type: 'received' }));

  receivedFilesCount++;
  
  if (expectedFilesCount > 0 && receivedFilesCount === expectedFilesCount) {
    log(`🎉 Todos os ${expectedFilesCount} arquivos foram recebidos com sucesso!`, 'success');
    
    if(!entry.isStreaming) { 
      log('💡 Dica: Clique em "Baixar" para salvar os arquivos recebidos.', 'info');
      $('downloadContainer').style.display = 'block';
    }

    // Reseta os contadores para segurança
    expectedFilesCount = 0;
    receivedFilesCount = 0;
  }
}

// ─── Envio ────────────────────────────────────────────────────────────────────
function offerFiles() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    log('⚠️ Canal ainda não está aberto', 'warn');
    return;
  }
  const files = Array.from($('fileInput').files);
  if (files.length === 0) return;

  $('sendQueueContainer').style.display = '';
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      log(`❌ ${file.name} muito grande (máx 1 GB) — pulado`, 'error');
      continue;
    }
    const li = createQueueItem($('sendQueue'), file.name, file.size);
    sendQueue.push({ file, id: uid(), listItem: li });
  }
}

function sendFiles() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    log('⚠️ Canal ainda não está aberto', 'warn');
    return;
  }
  const toSend = [...sendQueue];
  sendQueue = [];
  if (toSend.length === 0) { log('⚠️ Nenhum arquivo na fila', 'warn'); return; }

  // Inicializa (ou reinicia) o sinal de abortar para este lote de envio
  sendAbortController = new AbortController();

  // Anuncia quantos arquivos virão
  dataChannel.send(JSON.stringify({ type: 'offer-files', data: { total: toSend.length, size: toSend.reduce((a, b) => a + b.file.size, 0) } }));

  // Dispara todos em paralelo — cada um tem seu próprio id nos chunks
  // Passamos o sinal de abortar para a função de envio
  for (const entry of toSend) {
    sendSingleFile(entry, sendAbortController.signal);
  }

  // Limpa input e fila de envio
  $('fileInput').value = '';
}

function sendSingleFile({ file, listItem, id }, signal) {
  setItemStatus(listItem, 'active');
  log(`📤 Enviando: ${file.name} (${fmtMB(file.size)})`, 'info');

  // Metadados com id para o receptor criar a entrada correta
  dataChannel.send(JSON.stringify({ type: 'meta', data: { name: file.name, size: file.size, type: file.type, id } }));

  let offset = 0;
  const reader = new FileReader();

  const sendNextChunk = () => {
    // 🟥 CHECAGEM CRÍTICA: Se foi cancelado, para o envio imediatamente
    if (signal && signal.aborted) {
      setItemStatus(listItem, 'error');
      setItemSize(listItem, '(cancelado pelo destinatário)');
      return;
    }

    if (offset >= file.size) {
      setItemStatus(listItem, 'done');
      setItemSize(listItem, `(completo) ${fmtMB(file.size)}`);
      setItemProgress(listItem, 100);
      log(`📤 ${file.name} enviado`, 'success');
      return;
    }
    if (dataChannel.bufferedAmount > 1024 * 1024) {
      setTimeout(sendNextChunk, 50);
      return;
    }
    reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
  };

  reader.onload = async (e) => {
    // Outra checagem caso o abort ocorra durante a leitura do FileReader
    if (signal && signal.aborted) return;

    const idBytes = new TextEncoder().encode(id);
  
    // Aloca 4 bytes para o cabeçalho e escreve explicitamente em Little-Endian
    const headerBuffer = new ArrayBuffer(4);
    const headerView = new DataView(headerBuffer);
    headerView.setUint32(0, idBytes.length, true); // true = Little-Endian

    // Junta: [Header (4 bytes)][ID Bytes][Chunk do Arquivo]
    const buf = await new Blob([headerBuffer, idBytes, e.target.result]).arrayBuffer();
    dataChannel.send(buf);

    offset += e.target.result.byteLength;
    const pct = ((offset / file.size) * 100).toFixed(1);
    setItemSize(listItem, `${pct}% · ${fmtMB(offset)} de ${fmtMB(file.size)}`);
    setItemProgress(listItem, pct);
    sendNextChunk();
  };

  reader.onerror = () => {
    setItemStatus(listItem, 'error');
    log(`❌ Erro ao ler ${file.name}`, 'error');
  };

  sendNextChunk();
}

// ─── Download (memória) ───────────────────────────────────────────────────────
async function downloadAll() {
  const inMemory = receiveQueue.filter(e => !e.isStreaming && e.buffers.length > 0);
  if (inMemory.length === 0) { log('❌ Nenhum arquivo para baixar', 'error'); return; }

  for (const entry of inMemory) {
    const blob = new Blob(entry.buffers);
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: entry.meta?.name || 'arquivo' });

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    await new Promise(resolve => setTimeout(resolve, 500));
    URL.revokeObjectURL(url);
    entry.buffers = []; // libera memória do array de buffers
  }

  log(`${inMemory.length} arquivo(s) baixado(s)`, 'success');
}

// ─── Bindings ─────────────────────────────────────────────────────────────────
$('btn-connect') .addEventListener('click', connect);
$('fileInput')   .addEventListener('change', offerFiles);
$('btn-send')    .addEventListener('click', sendFiles);
$('btn-download').addEventListener('click', downloadAll);

log('Pronto. Configure o servidor e clique em Conectar.', 'info');
