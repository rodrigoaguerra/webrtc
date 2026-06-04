let socket;
let pc;
let dataChannel;
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

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB max
const CHUNK_SIZE = 256 * 1024; // 256KB chunks
const statusEl = document.getElementById("status");

// Verificar suporte File System Access API
const supportsFileSystemAPI = typeof window.showSaveFilePicker === "function";

const acceptBtn = document.getElementById("acceptBtn");
const acceptContainer = document.getElementById("acceptContainer");

function log(msg) {
  statusEl.innerText = msg;
}

async function prepareFileSave(fileMeta) {
  if (window.showSaveFilePicker) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: fileMeta.name,
        types: [
          { description: "Arquivo", accept: { [fileMeta.type || "application/octet-stream"]: [] } }
        ]
      });

      writable = await fileHandle.createWritable();
      useStream = true;
      isStreamingToFile = true;
      log(`💾 Salvando direto em disco (streaming)`);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Erro ao abrir arquivo:", err);
        log("⚠️ Usando memória em vez de disco");
      }
      useStream = false;
      isStreamingToFile = false;
      receivedBuffers = [];
    }
  } else {
    useStream = false;
    isStreamingToFile = false;
    receivedBuffers = [];
  }
  
  waitingForAccept = false;
  acceptContainer.style.display = "none";
  pendingTransfer = null;
  
  // Processar chunks que chegaram enquanto esperava
  if (pendingChunks.length > 0) {
    log(`📥 Processando ${pendingChunks.length} chunks pendentes...`);
    const chunks = [...pendingChunks];
    pendingChunks = [];
    
    for (const chunk of chunks) {
      if (isStreamingToFile && writable) {
        try {
          await writable.write(chunk);
        } catch (err) {
          console.error("Erro ao escrever arquivo:", err);
          log("❌ Erro ao salvar arquivo");
          return;
        }
      } else {
        receivedBuffers.push(chunk);
      }
      
      receivedSize += chunk.byteLength;
      const progress = ((receivedSize / totalSize) * 100).toFixed(2);
      const sizeMB = (receivedSize / 1024 / 1024).toFixed(2);
      log(`📥 ${progress}% (${sizeMB}MB)`);
    }
    
    if (receivedSize === totalSize) {
      if (isStreamingToFile && writable) {
        await writable.close();
        log("✅ Arquivo salvo em disco");
      } else {
        log("✅ Arquivo recebido (na memória)");
      }
    }
  }
}

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

    socket.emit("join-room", room);

    await initPeer(room);
  });

  socket.on("reconnect", async () => {
    log("Reconectado 🔄");

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
      socket.emit("candidate", {
        candidate: event.candidate,
        room
      });
    }
  };

  createOffer(room);
}

async function resetPeer(room) {
  if (pc) {
    pc.close();
    pc = null;
  }

  await initPeer(room);
}

async function setupDataChannel() {
  dataChannel.onopen = () => log("Canal aberto 🚀");

  dataChannel.onmessage = async (event) => {
    // metadata
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);

      if (msg.type === "meta") {
        fileMeta = msg.data;
        totalSize = fileMeta.size;

        // Validar tamanho máximo
        if (totalSize > MAX_FILE_SIZE) {
          log(`❌ Arquivo muito grande (${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB). Máximo: 1GB`);
          return;
        }

        receivedSize = 0;
        isStreamingToFile = false;
        waitingForAccept = true;
        pendingChunks = [];
        pendingTransfer = fileMeta;

        // Mostrar botão de aceitar transferência
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        log(`🔔 Recebimento de ${fileMeta.name} (${sizeMB}MB) aguardando aceite...`);
        
        document.getElementById("transferFileName").innerText = fileMeta.name;
        document.getElementById("transferFileSize").innerText = sizeMB + " MB";
        acceptContainer.style.display = "block";
        
        return; // Esperar usuário aceitar
      }

      if (msg.type === "received") {
        log("✅ Destinatário confirmou recebimento");
      }

      return;
    }

    // chunk binário
    if (waitingForAccept) {
      // Buffer os dados enquanto esperamos o usuário aceitar
      pendingChunks.push(event.data);
      return;
    }

    if (isStreamingToFile && writable) {
      try {
        await writable.write(event.data);
      } catch (err) {
        console.error("Erro ao escrever arquivo:", err);
        log("❌ Erro ao salvar arquivo");
        return;
      }
    } else {
      receivedBuffers.push(event.data);
    }

    receivedSize += event.data.byteLength;

    const progress = ((receivedSize / totalSize) * 100).toFixed(2);
    const sizeMB = (receivedSize / 1024 / 1024).toFixed(2);

    log(`📥 ${progress}% (${sizeMB}MB)`);
    
    if (receivedSize === totalSize) {
      if (isStreamingToFile && writable) {
        await writable.close();
        log("✅ Arquivo salvo em disco");
      } else {
        log("✅ Arquivo recebido (na memória)");
      }

      dataChannel.send(JSON.stringify({
        type: "received"
      }));
    }
  };
}

async function createOffer(room) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", { offer, room });
}

// Event listener para botão de aceitar transferência
if (acceptBtn) {
  acceptBtn.addEventListener("click", async () => {
    if (pendingTransfer) {
      acceptBtn.disabled = true;
      acceptBtn.innerText = "Processando...";
      
      await prepareFileSave(pendingTransfer);
      
      acceptBtn.disabled = false;
      acceptBtn.innerText = "Aceitar";
    }
  });
}

// envio em chunks com throttling
function sendFile() {
  const file = document.getElementById("fileInput").files[0];
  
  if (!file) {
    log("❌ Selecione um arquivo");
    return;
  }

  // Validar tamanho
  if (file.size > MAX_FILE_SIZE) {
    log(`❌ Arquivo muito grande (${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB). Máximo: 1GB`);
    return;
  }

  fileMeta = {
    name: file.name,
    size: file.size,
    type: file.type
  };

  totalSize = file.size;
  log(`📤 Enviando: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  // envia metadata primeiro
  dataChannel.send(JSON.stringify({
    type: "meta",
    data: fileMeta
  }));

  sendChunks(file);
}

function sendChunks(file) {
  let offset = 0;
  const reader = new FileReader();

  const sendNextChunk = () => {
    if (offset >= file.size) {
      log("✅ Arquivo enviado completo");
      return;
    }

    // Throttling: esperar se buffer estiver cheio
    if (dataChannel.bufferedAmount > 1024 * 1024) {
      setTimeout(sendNextChunk, 100);
      return;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.readAsArrayBuffer(slice);
  };

  reader.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;

    const progress = ((offset / file.size) * 100).toFixed(2);
    const sizeMB = (offset / 1024 / 1024).toFixed(2);
    log(`📤 Enviando: ${progress}% (${sizeMB}MB)`);

    sendNextChunk();
  };

  sendNextChunk();
}

async function download() {
  if (isStreamingToFile) {
    log("📁 Arquivo já foi salvo em disco");
    return;
  }

  if (receivedBuffers.length === 0) {
    log("❌ Nenhum arquivo para baixar");
    return;
  }

  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
  log(`📥 Preparando download ${totalSizeMB}MB...`);

  const blob = new Blob(receivedBuffers);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileMeta?.name || "arquivo";
  a.click();

  log("✅ Download iniciado");

  // Limpar referência após download
  setTimeout(() => URL.revokeObjectURL(url), 100);
}