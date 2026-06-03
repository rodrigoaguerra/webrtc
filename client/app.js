let socket;
let pc;
let dataChannel;
let receivedBuffers = [];
let fileMeta = null;
let receivedSize = 0;
let totalSize = 0;

const statusEl = document.getElementById("status");

function log(msg) {
  statusEl.innerText = msg;
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

function connect() {
  const room = document.getElementById("room").value;

  socket = io("http://localhost:3000", {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  initPeer(room);

  socket.on("connect", () => {
    log("Conectado ao servidor");

    socket.emit("join-room", room);
  });

  socket.on("reconnect", () => {
    log("Reconectado 🔄");

    socket.emit("join-room", room);

    resetPeer(room);
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

function initPeer(room) {
  pc = new RTCPeerConnection(config);

  dataChannel = pc.createDataChannel("file");

  setupDataChannel();

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
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

function resetPeer(room) {
  if (pc) {
    pc.close();
    pc = null;
  }

  initPeer(room);
}

function setupDataChannel() {
  dataChannel.onopen = () => log("Canal aberto 🚀");

  dataChannel.onmessage = (event) => {
    // metadata
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);

      if (msg.type === "meta") {
        fileMeta = msg.data;
        totalSize = fileMeta.size;
        receivedSize = 0;
        receivedBuffers = [];

        log(`Recebendo: ${fileMeta.name} (${(fileMeta.size / 1024).toFixed(2)} KB)`);
      }

      if (msg.type === "received") {
        log("Destinatário confirmou recebimento ✅");
      }

      return;
    }

    // chunk binário
    receivedBuffers.push(event.data);
    receivedSize += event.data.byteLength;

    const progress = ((receivedSize / totalSize) * 100).toFixed(2);

    log(`Recebendo: ${progress}%`);
    
    if (receivedSize === totalSize) {
      log("Arquivo recebido completo ✅");

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

// envio em chunks
function sendFile() {
  const file = document.getElementById("fileInput").files[0];

  fileMeta = {
    name: file.name,
    size: file.size
  };

  totalSize = file.size;

  // envia metadata primeiro
  dataChannel.send(JSON.stringify({
    type: "meta",
    data: fileMeta
  }));

  sendChunks(file);
}

function sendChunks(file) {
  const chunkSize = 16 * 1024;
  let offset = 0;

  const reader = new FileReader();

  reader.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;

    // progresso envio
    const progress = ((offset / file.size) * 100).toFixed(2);
    log(`Enviando: ${progress}%`);

    if (offset < file.size) {
      readSlice(offset);
    } else {
      log("Arquivo enviado ✅");
    }
  };

  function readSlice(o) {
    const slice = file.slice(o, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  }

  readSlice(0);
}

function download() {
  const blob = new Blob(receivedBuffers);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileMeta?.name || "arquivo";
  a.click();

  log("Download iniciado 📥");
}