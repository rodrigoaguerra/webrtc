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

// Modo de Envio
let peerMode = 'memory';

// Modo de Recepção
let peerReceiveMode = 'memory'; // padrão conservador até receber confirmação

// Confirmação de envio
let receivedAckResolvers = {}; // { [id]: resolve } — aguarda confirmação do peer

// Controlador de abortos para envios em andamento, caso o remetente rejeite os arquivos
let sendAbortController = null;

// Pasta destino escolhida pelo usuário, caso File System Access API esteja disponível
let targetDirHandle = null; 

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
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️', send: '📦', receive: '📥' };
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

function detectReceiveMode() {
  const hasFileSystem = typeof window.showSaveFilePicker === 'function';
  return hasFileSystem ? 'disk' : 'memory';
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

    // Inicializa o peer SEM criar canal nem offer — aguarda ver se há peer na sala
    await initPeer(room);
  });

  // Só dispara em quem já estava na sala (Lado A)
  // quando o Lado B chega, o Lado A recebe esse evento e faz a offer
  socket.on('user-connected', async () => {
    log('Peer entrou na sala — iniciando offer…', 'info');
    dataChannel = pc.createDataChannel('file');
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannel();
    await createOffer(room);
  });

  socket.on('offer', async ({ offer }) => {
    // Lado B: recebe a offer, NÃO cria canal — vai chegar via ondatachannel
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
  log('PeerConnection criada', 'info');

  // Lado B recebe o canal aqui
  pc.ondatachannel = (event) => {
    // Se já tem um canal aberto, ignora
    dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannel();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('candidate', { candidate: e.candidate, room });
  };

  pc.onconnectionstatechange = () => {
    log(`Peer: ${pc.connectionState}`, 'info');
    if  (pc.connectionState === 'connecting') {
      setDot('peer', 'yellow');
      log('Estabelecendo conexão... ', 'warn');
    } 
    if (pc.connectionState === 'connected') {
      setDot('peer', 'green');
      log('Conexão estabelecida com sucesso 🚀', 'success');
    }
    if (pc.connectionState === 'disconnected' || 
        pc.connectionState === 'failed') 
        setDot('peer', 'red');
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

// ─── DataChannel ──────────────────────────────────────────────────────────────
function setupDataChannel() {
  dataChannel.onopen = () => {
    $('fileInput').disabled = false;
    $('folderInput').disabled = false;
    $('btn-send').disabled  = false;

    // Anuncia o modo de recepção ao peer
    const mode = detectReceiveMode();
    peerMode = mode;
    dataChannel.send(JSON.stringify({ type: 'receive-mode', mode }));
  };

  dataChannel.onclose = () => {
    log('Canal fechado', 'error');
    setDot('peer', 'red');
    $('fileInput').disabled = true;
    $('folderInput').disabled = true; 
    $('btn-send').disabled  = true;
  };

  dataChannel.onmessage = async (event) => {
    // ── Texto: meta ou confirmação ──────────────────────────────────────────
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);

      // Dentro do handler de mensagens:
      if (msg.type === 'receive-mode') {
        peerReceiveMode = msg.mode;
        log(`Peer recebe por: ${peerReceiveMode}`, 'info');
        return;
      }

      if (msg.type === 'offer-files') {
        expectedFilesCount = msg.data.total;
        expectedTotalSize = msg.data.size;
        receivedFilesCount = 0; // Reseta para o novo lote de envios
        log(`Um novo lote de ${expectedFilesCount} arquivo(s) com ${fmtMB(expectedTotalSize)} está sendo enviado...`, 'send');
        return;
      }

      if(msg.type === 'files-rejected') {
        log(`O remetente rejeitou os arquivos: ${msg.data.error}`, 'error');
        log('O remetente pode ter rejeitado os arquivos por serem grandes demais para processar em memória. Considere usar um navegador moderno com suporte a File System Access API para salvar diretamente em disco.', 'warn');
        
        // 🟥 Cancela imediatamente todos os envios em andamento
        if (sendAbortController) {
          sendAbortController.abort();
          const lis = $('sendQueue').querySelectorAll('li');
          for (const li of lis) setItemStatus(li, 'error');
          log('🛑 Todos os envios ativos foram interrompidos localmente.', 'error');
        }
        return;
      }

      if (msg.type === 'meta') {
        const meta = msg.data;

        if (meta.size > MAX_FILE_SIZE && peerMode === 'memory') {
          log(`❌ ${meta.name} muito grande (máx 1.5 GB)`, 'error');
          return;
        }

        $('emptyReceiveQueue').style.display = 'none';

        const li = createQueueItem($('receiveQueue'), meta.name, meta.size);

        const entry = {
          meta, id: meta.id, listItem: li,
          buffers: [], receivedSize: 0, isStreaming: false, writable: null
        };
        
        receiveQueue.push(entry);

        // Reserva slot de chunks pendentes para este arquivo
        pendingChunksMap[meta.id] = [];

        if (peerMode === 'disk') {
          // só enfileira para aceite manual no modo disk
          acceptQueue.push(entry);
          showAcceptTransfer();
        } else {
          // memory — aceita automaticamente, sem botão, sem painel
          pendingChunksMap[entry.meta.id] = [];
          // drena imediatamente — não tem nada ainda, mas já marca como aceito
          delete pendingChunksMap[entry.meta.id]; // ← remove o bloqueio de chunks
        }
        return;
      }

      if (msg.type === 'received') {
        log(`Destinatário confirmou recebimento de ${msg.data.name} `, 'success');
        const resolve = receivedAckResolvers[msg.data.id];
        if (resolve) {
          resolve();
          delete receivedAckResolvers[msg.data.id];
        }
        return;
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
function showAcceptTransfer() {
  log(`🔔 (${fmtMB(expectedTotalSize)}) aguardando aceite...`, 'warn');
  
  $('transferFileName').innerText    = 'Aceite a transferência dos arquivos';
  $('transferFileSize').innerText    = fmtMB(expectedTotalSize);
  $('acceptContainer').style.display = 'block';
  
  const lis = $('receiveQueue').querySelectorAll('li');
  for (const li of lis) setItemStatus(li, 'pending');
}

// Aceita todos os arquivos pendentes na fila em mode: 'disk'
async function acceptEntry() {
  if (acceptQueue.length === 0) return;

  const acceptBtn = $('btn-accept');
  acceptBtn.disabled  = true;
  acceptBtn.innerText = 'Processando...';

  const entry = acceptQueue.shift();
  setItemStatus(entry.listItem, 'active');

  const allEntries = [entry, ...acceptQueue];
  acceptQueue = [];

  // Pede a pasta destino uma única vez para todo o lote
  try {
    if (!targetDirHandle) {
      targetDirHandle = await window.showDirectoryPicker();
      log(`📁 Pasta destino: "${targetDirHandle.name}"`, 'info');
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
    log(`Erro ao abrir pasta destino: ${err.message}`, 'error');
    dataChannel.send(JSON.stringify({ type: 'files-rejected', data: { error: 'Erro ao abrir pasta de destino' } }));
    $('acceptContainer').style.display = 'none';
    isAccepting = false;
    acceptBtn.disabled  = false;
    acceptBtn.innerText = 'Aceitar';
    return;
  }

  for (const e of allEntries) {
    try {
      const parts    = (e.meta.relativePath || e.meta.name).split('/');
      const fileName = parts.pop();

      let dir = targetDirHandle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }

      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      e.writable   = await fileHandle.createWritable();
      e.isStreaming = true;
      log(`💾 Salvando "${e.meta.name}" em disco`, 'info');
    } catch (err) {
      e.isStreaming = false;
      log(`⚠️ "${e.meta.name}" ficará em memória`, 'warn');
    }

    await drainAndFinalize(e);
  }

  $('acceptContainer').style.display = 'none';
  isAccepting = false;
  acceptBtn.disabled  = false;
  acceptBtn.innerText = 'Aceitar';
}

async function drainAndFinalize(e) {
  setItemStatus(e.listItem, 'active');
  const queued = pendingChunksMap[e.id] ?? [];
  delete pendingChunksMap[e.id];
  for (const chunk of queued) await writeChunk(e, chunk);
  if (e.receivedSize > 0) updateProgress(e);
  if (e.receivedSize >= e.meta.size) await finalizeReceive(e);
}

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

// ─── Envio ────────────────────────────────────────────────────────────────────
function offerFiles() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    log('⚠️ Canal ainda não está aberto', 'warn');
    return;
  }

  // Junta arquivos avulsos + arquivos da pasta
  const fileList   = Array.from($('fileInput').files);
  const folderList = Array.from($('folderInput').files);
  const files      = [...fileList, ...folderList];
  
  if (files.length === 0) return;

  $('emptySendQueue').style.display = 'none';
  
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE && peerReceiveMode === 'memory') {
      log(`❌ ${file.name} muito grande (máx 1.5 GB) — pulado`, 'error');
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

  // Inicializa (ou reinicia) o sinal de abortar para este lote de envio
  sendAbortController = new AbortController();

  // Anuncia quantos arquivos virão
  dataChannel.send(JSON.stringify({ type: 'offer-files', data: { total: toSend.length, size: toSend.reduce((a, b) => a + b.file.size, 0) } }));

  /**
   * Modo de Recepção: 
   *  - 'memory' : envia um por um, aguardando Promise
   *  - 'disk'   : envia em paralelo, sem aguardar Promise
   * Passamos o sinal de abortar para a função de envio
   */
  if (peerReceiveMode === 'memory') {
    for (const file of toSend) {
      // 1. envia o arquivo e aguarda todos os chunks saírem
      await sendSingleFile(file, sendAbortController.signal);

      // 2. aguarda confirmação do receptor antes de enviar o próximo
      await new Promise((resolve) => {
        receivedAckResolvers[file.id] = resolve;

        dataChannel.addEventListener('close', () => {
          if (receivedAckResolvers[file.id]) {
            delete receivedAckResolvers[file.id];
            resolve();
          }
        }, { once: true });
      });
    }
  } else {
    for (const file of toSend) {
      sendSingleFile(file, sendAbortController.signal);
    }
  }

  // Limpa input de arquivos
  $('fileInput').value = '';
  $('folderInput').value = '';
}

function sendSingleFile({ file, listItem, id, relativePath }, signal) {
  return new Promise((resolve) => {          // ← adiciona o wrapper
    setItemStatus(listItem, 'active');
    log(`Enviando: ${file.name} (${fmtMB(file.size)})`, 'send');

    dataChannel.send(JSON.stringify({ type: 'meta', data: { name: file.name, size: file.size, type: file.type, id, relativePath: relativePath } }));

    let offset = 0;
    const reader = new FileReader();

    const sendNextChunk = () => {
      if (signal && signal.aborted) {
        setItemStatus(listItem, 'error');
        setItemSize(listItem, '(cancelado pelo destinatário)');
        resolve();                           // ← resolve mesmo no abort
        return;
      }

      if (offset >= file.size) {
        setItemStatus(listItem, 'done');
        setItemSize(listItem, `(completo) ${fmtMB(file.size)}`);
        setItemProgress(listItem, 100);
        log(`${file.name} enviado`, 'send');
        resolve();                           // ← resolve ao terminar
        return;
      }

      if (dataChannel.bufferedAmount > 1024 * 1024) {
        setTimeout(sendNextChunk, 50);
        return;
      }
      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
    };

    reader.onload = async (e) => {
      if (signal && signal.aborted) { resolve(); return; }

      const idBytes = new TextEncoder().encode(id);
      const headerBuffer = new ArrayBuffer(4);
      const headerView = new DataView(headerBuffer);
      headerView.setUint32(0, idBytes.length, true);

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
      resolve();                             // ← resolve no erro também
    };

    sendNextChunk();
  });  
}

// ─── Finalização de Recepção ───────────────────────────────────────────────────────
async function finalizeReceive(entry) {
  if (entry.isStreaming && entry.writable) {
    await entry.writable.close();
    log(`${entry.meta.name} salvo em disco`, 'success');
  } else {
    // Download automático assim que terminar
    const blob = new Blob(entry.buffers);
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download:   entry.meta.relativePath || entry.meta.name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    entry.buffers = []; // libera memória imediatamente

    log(`${entry.meta.name} baixado automaticamente`, 'receive');
  }

  setItemStatus(entry.listItem, 'done');
  setItemSize(entry.listItem, `(completo) ${fmtMB(entry.meta.size)}`);
  setItemProgress(entry.listItem, 100);
  dataChannel.send(JSON.stringify({ type: 'received', data: { name: entry.meta.name, id: entry.meta.id } }));

  receivedFilesCount++;
  
  if (expectedFilesCount > 0 && receivedFilesCount === expectedFilesCount) {
    log(`Todos os ${expectedFilesCount} arquivos foram recebidos com sucesso! 🎉`, 'success');
    targetDirHandle = null; // ← libera para o próximo lote escolher nova pasta
    // Reseta os contadores para segurança
    expectedFilesCount = 0;
    receivedFilesCount = 0;
  }
}

// ─── Antes de sair verificar se upload / download estão em andamento ───────────────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  const enviando   = sendQueue.length > 0;
  const recebendo  = receiveQueue.some(entry => entry.receivedSize < entry.meta?.size);

  if (enviando || recebendo) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ─── Bindings ─────────────────────────────────────────────────────────────────
$('btn-connect') .addEventListener('click', connect);
$('fileInput')   .addEventListener('change', offerFiles);
$('folderInput').addEventListener('change', offerFiles);
$('btn-send')    .addEventListener('click', sendFiles);
$('btn-accept')  .addEventListener('click', acceptEntry);

log('Pronto. Configure o servidor e clique em Conectar.', 'info');
