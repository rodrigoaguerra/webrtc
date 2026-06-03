let socket;
let pc;
let dataChannel;
let receivedBuffers = [];

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

  socket = io("http://localhost:3000");

  socket.emit("join-room", room);

  initPeer(room);

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

function setupDataChannel() {
  dataChannel.onopen = () => log("Canal aberto 🚀");

  dataChannel.onmessage = (event) => {
    receivedBuffers.push(event.data);
    log("Recebendo...");
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
  const chunkSize = 16 * 1024;
  let offset = 0;

  const reader = new FileReader();

  reader.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;

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
  a.download = "arquivo_recebido";
  a.click();

  log("Download iniciado 📥");
}