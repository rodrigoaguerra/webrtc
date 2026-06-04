// ─── Estado Global ──────────────────────────────────────────────────────────
let socket;
let pc;
let dataChannel;

// Recebimento
let receivedBuffers = [];
let fileMeta = null;
let receivedSize = 0;
let totalSize = 0;
let fileHandle = null;
let writable = null;
let useStream = false;
let isStreamingToFile = false;
let pendingTransfer = null;
let waitingForAccept = false;
let pendingChunks = [];

// ── NOVO: Filas de múltiplos arquivos ──────────────────────────────────────
/** @type {{ file: File, id: string, listItem: HTMLLIElement }[]} */
let sendQueue = [];
let isSending = false;          // semáforo: só um arquivo é enviado por vez

/** @type {{ meta: object, buffers: ArrayBuffer[], id: string, listItem: HTMLLIElement }[]} */
let receiveQueue = [];          // todos os arquivos recebidos (ou em recebimento)
let currentReceiveEntry = null; // entrada ativa no recebimento

// ─── Constantes ─────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
const CHUNK_SIZE = 256 * 1024;            // 256 KB

// ─── Elementos DOM ──────────────────────────────────────────────────────────
const statusEl              = document.getElementById("status");
const acceptBtn             = document.getElementById("acceptBtn");
const acceptContainer       = document.getElementById("acceptContainer");
const sendQueueContainer    = document.getElementById("sendQueueContainer");
const sendQueueEl           = document.getElementById("sendQueue");
const receiveQueueContainer = document.getElementById("receiveQueueContainer");
const receiveQueueEl        = document.getElementById("receiveQueue");
const connectionStatusEl    = document.getElementById("connectionStatus");

// ─── Helpers ────────────────────────────────────────────────────────────────
function log(msg) { statusEl.innerText = msg; }

function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(2) + " MB"; }

function uid() { return Math.random().toString(36).slice(2, 9); }


/** 
 * Atualiza o chip de status de conexão com texto e cor apropriados. 
* Ex: "Conectado" (verde), "Reconectando..." (amarelo), "Desconectado" (vermelho).
 * @param {string} text 
 */
function updateConnectionStatus(text) {
  if (!connectionStatusEl) return;

  connectionStatusEl.innerText = text;
  connectionStatusEl.className = "status-chip";

  if (text.toLowerCase().includes("conectado")) {
    connectionStatusEl.classList.add("online");
  } else if (text.toLowerCase().includes("reconect")) {
    connectionStatusEl.classList.add("reconnecting");
  } else {
    connectionStatusEl.classList.add("offline");
  }
}

/**
 * Cria um <li> na fila visual e retorna a referência.
 * @param {HTMLUListElement} listEl
 * @param {string} name
 * @param {number} size
 */
function createQueueItem(listEl, name, size) {
  const li = document.createElement("li");
  li.className = "status-pending";
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
  const icons = { pending: "📄", active: "🔄", done: "✅", error: "❌" };
  li.querySelector(".file-icon").textContent = icons[status] ?? "📄";
}

function setItemProgress(li, pct) {
  li.querySelector(".file-progress-bar").style.width = pct + "%";
}

// ─── WebRTC / Socket.IO ─────────────────────────────────────────────────────
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

async function connect() {
  const room = document.getElementById("room").value;

  socket = io("http://localhost:3000", {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on("connect", async () => {
    log("Conectado ao servidor");
    updateConnectionStatus("Conectado");
    socket.emit("join-room", room);
    await initPeer(room);
  });

  socket.on("disconnect", () => {
    log("Desconectado do servidor");
    updateConnectionStatus("Desconectado");
  });

  socket.on("reconnect", async () => {
    log("Reconectado 🔄");
    updateConnectionStatus("Reconectado");
    socket.emit("join-room", room);
    await resetPeer(room);
  });

  socket.on("offer", async (offer) => {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { answer, room });
  });

  socket.on("answer", async (answer) => {
    await pc.setRemoteDescription(answer);
  });

  socket.on("candidate", async (candidate) => {
    await pc.addIceCandidate(candidate);
  });
}

async function initPeer(room) {
  pc = new RTCPeerConnection(config);
  dataChannel = pc.createDataChannel("file");
  await setupDataChannel();

  pc.ondatachannel = async (event) => {
    dataChannel = event.channel;
    await setupDataChannel();
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", { candidate: event.candidate, room });
    }
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
  socket.emit("offer", { offer, room });
}

// ─── Recebimento ─────────────────────────────────────────────────────────────
async function setupDataChannel() {
  dataChannel.onopen = () => log("Canal aberto 🚀");

  dataChannel.onmessage = async (event) => {
    // ── Mensagem de texto (metadata / confirmação) ──
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);

      if (msg.type === "meta") {
        // Cada "meta" abre uma nova entrada na fila de recebimento
        const meta = msg.data;

        if (meta.size > MAX_FILE_SIZE) {
          log(`❌ ${meta.name} muito grande. Máximo: 1 GB`);
          return;
        }

        // Criar entrada na fila visual
        receiveQueueContainer.style.display = "";
        const li = createQueueItem(receiveQueueEl, meta.name, meta.size);

        const entry = {
          meta,
          id: uid(),
          listItem: li,
          buffers: [],
          receivedSize: 0,
          isStreaming: false,
          writable: null
        };
        receiveQueue.push(entry);

        // Mostrar painel de aceite
        fileMeta        = meta;
        totalSize       = meta.size;
        receivedSize    = 0;
        waitingForAccept = true;
        pendingChunks    = [];
        pendingTransfer  = entry;
        currentReceiveEntry = entry;

        const sizeMB = fmtMB(meta.size);
        log(`🔔 ${meta.name} (${sizeMB}) aguardando aceite...`);
        document.getElementById("transferFileName").innerText = meta.name;
        document.getElementById("transferFileSize").innerText = sizeMB;
        acceptContainer.style.display = "block";

        setItemStatus(li, "pending");
        return;
      }

      if (msg.type === "received") {
        log("✅ Destinatário confirmou recebimento");
        // Avançar fila de envio (próximo arquivo)
        isSending = false;
        processNextSend();
      }
      return;
    }

    // ── Chunk binário ──
    const entry = currentReceiveEntry;
    if (!entry) return;

    if (waitingForAccept) {
      pendingChunks.push(event.data);
      return;
    }

    await writeChunk(entry, event.data);

    const progress = ((entry.receivedSize / entry.meta.size) * 100).toFixed(1);
    setItemProgress(entry.listItem, progress);
    log(`📥 ${entry.meta.name}: ${progress}% (${fmtMB(entry.receivedSize)})`);

    if (entry.receivedSize >= entry.meta.size) {
      await finalizeReceive(entry);
    }
  };
}

/** Escreve um chunk na entrada correta (disco ou memória). */
async function writeChunk(entry, data) {
  if (entry.isStreaming && entry.writable) {
    try {
      await entry.writable.write(data);
    } catch (err) {
      console.error("Erro ao escrever:", err);
      log("❌ Erro ao salvar");
    }
  } else {
    entry.buffers.push(data);
  }
  entry.receivedSize += data.byteLength;
}

async function finalizeReceive(entry) {
  if (entry.isStreaming && entry.writable) {
    await entry.writable.close();
    log(`✅ ${entry.meta.name} salvo em disco`);
  } else {
    log(`✅ ${entry.meta.name} recebido (na memória)`);
  }

  setItemStatus(entry.listItem, "done");
  setItemProgress(entry.listItem, 100);

  dataChannel.send(JSON.stringify({ type: "received" }));
}

// Botão Aceitar
if (acceptBtn) {
  acceptBtn.addEventListener("click", async () => {
    if (!pendingTransfer) return;
    acceptBtn.disabled = true;
    acceptBtn.innerText = "Processando...";

    const entry = pendingTransfer;
    setItemStatus(entry.listItem, "active");

    // Tentar abrir File System Access API
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: entry.meta.name,
          types: [{ description: "Arquivo", accept: { [entry.meta.type || "application/octet-stream"]: [] } }]
        });
        entry.writable = await handle.createWritable();
        entry.isStreaming = true;
        log(`💾 Salvando em disco (streaming)`);
      } catch (err) {
        if (err.name !== "AbortError") console.error(err);
        entry.isStreaming = false;
      }
    }

    waitingForAccept = false;
    acceptContainer.style.display = "none";
    pendingTransfer = null;

    // Processar chunks que chegaram enquanto esperava
    if (pendingChunks.length > 0) {
      for (const chunk of pendingChunks) {
        await writeChunk(entry, chunk);
      }
      pendingChunks = [];

      const pct = ((entry.receivedSize / entry.meta.size) * 100).toFixed(1);
      setItemProgress(entry.listItem, pct);

      if (entry.receivedSize >= entry.meta.size) {
        await finalizeReceive(entry);
      }
    }

    acceptBtn.disabled = false;
    acceptBtn.innerText = "Aceitar";
  });
}

// ─── Envio ───────────────────────────────────────────────────────────────────

/**
 * Ponto de entrada: lê os arquivos selecionados e adiciona à fila.
 * (Substitui o antigo sendFile())
 */
function sendFiles() {
  const files = Array.from(document.getElementById("fileInput").files);

  if (files.length === 0) {
    log("❌ Selecione ao menos um arquivo");
    return;
  }

  sendQueueContainer.style.display = "";

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      log(`❌ ${file.name} muito grande (máx 1 GB) — pulado`);
      continue;
    }

    const li = createQueueItem(sendQueueEl, file.name, file.size);
    sendQueue.push({ file, id: uid(), listItem: li });
  }

  // Limpar input para permitir re-seleção dos mesmos arquivos
  document.getElementById("fileInput").value = "";

  processNextSend();
}

/** Envia o próximo arquivo da fila, se não houver envio em andamento. */
function processNextSend() {
  if (isSending || sendQueue.length === 0) return;

  const entry = sendQueue.shift();
  isSending = true;
  sendSingleFile(entry);
}

/** Envia um arquivo individual e atualiza a fila visual. */
function sendSingleFile({ file, listItem }) {
  setItemStatus(listItem, "active");

  const meta = { name: file.name, size: file.size, type: file.type };
  log(`📤 Enviando: ${file.name} (${fmtMB(file.size)})`);

  // Enviar metadados
  dataChannel.send(JSON.stringify({ type: "meta", data: meta }));

  // Enviar chunks
  let offset = 0;
  const reader = new FileReader();

  const sendNextChunk = () => {
    if (offset >= file.size) {
      setItemStatus(listItem, "done");
      setItemProgress(listItem, 100);
      log(`📤 ${file.name} enviado — aguardando confirmação...`);
      // isSending = false é definido quando chega msg "received"
      return;
    }

    if (dataChannel.bufferedAmount > 1024 * 1024) {
      setTimeout(sendNextChunk, 100);
      return;
    }

    reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
  };

  reader.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;

    const pct = ((offset / file.size) * 100).toFixed(1);
    setItemProgress(listItem, pct);
    log(`📤 ${file.name}: ${pct}% (${fmtMB(offset)})`);

    sendNextChunk();
  };

  reader.onerror = () => {
    setItemStatus(listItem, "error");
    log(`❌ Erro ao ler ${file.name}`);
    isSending = false;
    processNextSend();
  };

  sendNextChunk();
}

// ─── Download (todos os arquivos em memória) ─────────────────────────────────
async function downloadAll() {
  const inMemory = receiveQueue.filter(e => !e.isStreaming && e.buffers.length > 0);

  if (inMemory.length === 0) {
    log("❌ Nenhum arquivo disponível para baixar");
    return;
  }

  for (const entry of inMemory) {
    const blob = new Blob(entry.buffers);
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), {
      href: url,
      download: entry.meta?.name || "arquivo"
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  log(`✅ ${inMemory.length} arquivo(s) baixado(s)`);
}

// Manter retrocompatibilidade com o botão "Baixar" original no HTML
function download() { downloadAll(); }
