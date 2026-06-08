const $ = id => document.getElementById(id);
const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

function log(msg, type = '') {
  const line = document.createElement('div');
  line.className = 'log-line';
  const icons = { success:'✅', error:'❌', warn:'⚠️', info:'ℹ️' };
  line.innerHTML = `
    <span class="log-time">${now()}</span>
    <span class="log-icon">${icons[type] || '·'}</span>
    <span class="log-msg ${type}">${msg}</span>`;
  $('log').appendChild(line);
  $('log').scrollTop = 9999;
}

function setDot(id, state) {
  const d = $(`dot-${id}`);
  d.className = 'dot ' + state;
}

/* ── State ── */
let pc = null, localStream = null;
let currentRoom = '';
let socket = null;

/* ── ICE config ── */
const iceConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/* ── Sinalização genérica ── */
function send(event, payload = {}) {
  if (!socket || !socket.connected) return;
  socket.emit(event, payload);
}

function connect() {
  const url = $('srv').value.trim();
  currentRoom = $('room').value.trim();

  socket = io(url);

  setDot('ws', 'yellow');
  log(`Conectando em ${url}…`, 'info');

  socket.on('connect', () => {
    setDot('ws', 'green');
    log('Socket.IO conectado!', 'success');

    socket.emit('join-room', { room: currentRoom });

    setDot('room', 'green');
    log(`Entrou na sala "${currentRoom}"`, 'success');

    $('btn-connect').disabled = true;
    $('btn-camera').disabled  = false;
  });

  // CORREÇÃO: O servidor envia diretamente a 'offer' crua, não um objeto empacotado
  socket.on('offer', async ({ offer }) => {
    log('Offer recebida — respondendo…', 'info');

    try {
      await ensurePeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      send('answer', {
        answer,
        room: currentRoom
      });
    } catch (err) {
      log(`Erro ao processar Offer: ${err.message}`, 'error');
    }
  });

  // CORREÇÃO: O servidor envia diretamente a 'answer' crua
  socket.on('answer', async ({ answer }) => {
    log('Answer recebida', 'info');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      log(`Erro ao aplicar Answer: ${err.message}`, 'error');
    }
  });

  // CORREÇÃO: O servidor envia diretamente o 'candidate' cru
  socket.on('candidate', async ({ candidate }) => {
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log('ICE candidate adicionado', '');
      } catch (err) {
        log(`Erro ao adicionar ICE: ${err.message}`, 'error');
      }
    }
  });

  socket.on('disconnect', () => {
    setDot('ws', 'red');
    setDot('room', 'red');
    log('Socket desconectado', 'error');

    $('btn-connect').disabled = false;
    $('btn-camera').disabled  = true;
    $('btn-call').disabled    = true;
  });

  socket.on('connect_error', () => {
    log('Erro de conexão no Socket.IO', 'error');
    setDot('ws', 'red');
  });
}

/* ── PeerConnection ── */
async function ensurePeerConnection() {
  if (pc) return;
  pc = new RTCPeerConnection(iceConfig);
  setDot('peer', 'yellow');
  log('PeerConnection criada', 'info');

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) send('candidate', { candidate, room: currentRoom });
  };

  pc.ontrack = ({ streams }) => {
    $('remote-video').srcObject = streams[0];
    $('ph-remote').style.display = 'none';
    setDot('peer', 'green');
    log('Stream remoto recebido 🎉', 'success');
  };

  pc.onconnectionstatechange = () => {
    log(`Peer state: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      setDot('peer', 'green');
    }
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setDot('peer', 'red');
    }
  };
}

/* ── Câmera ── */
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('local-video').srcObject = localStream;
    $('ph-local').style.display = 'none';
    log('Câmera e microfone ativos', 'success');
    $('btn-call').disabled   = false;
    $('btn-camera').disabled = true;
    $('btn-hangup').disabled = false;
  } catch (e) {
    log(`Câmera negada: ${e.message}`, 'error');
  }
}

/* ── Ligar ── */
async function call() {
  await ensurePeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send('offer', { offer, room: currentRoom });
  log('Offer enviada — aguardando resposta…', 'info');
  $('btn-call').disabled = true;
}

/* ── Desligar ── */
function hangup() {
  if (pc)          { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $('local-video').srcObject  = null;
  $('remote-video').srcObject = null;
  $('ph-local').style.display  = '';
  $('ph-remote').style.display = '';
  setDot('peer', '');
  $('btn-hangup').disabled = true;
  $('btn-call').disabled   = true;
  $('btn-camera').disabled = false;
  log('Chamada encerrada', 'warn');
}

/* ── Bindings ── */
$('btn-connect').addEventListener('click', connect);
$('btn-camera') .addEventListener('click', startCamera);
$('btn-call')   .addEventListener('click', call);
$('btn-hangup') .addEventListener('click', hangup);

log('Pronto. Configure o servidor e clique em Conectar.', 'info');
