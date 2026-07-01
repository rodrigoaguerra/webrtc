import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Box, Typography, styled } from '@mui/material';
import HeaderComponent from '../components/HeaderComponent';
import StatusComponent from '../components/StatusComponent';
import ConectionComponent from '../components/ConectionComponent';
import ActionsComponent from '../components/ActionsComponent';
import VideoGridComponent from '../components/VideoGridComponent';
import LogComponent from '../components/LogComponent';

// ── Estilização Baseada no seu style.css ──
const PageWrapper = styled(Box)(() => ({
  '--bg': '#0b0f1a',
  '--surface': '#111827',
  '--border': '#1e2a3a',
  '--accent': '#00e5ff',
  '--accent2': '#7c3aed',
  '--green': '#22c55e',
  '--red': '#ef4444',
  '--yellow': '#facc15',
  '--text': '#e2e8f0',
  '--muted': '#64748b',
  '--font-mono': '"JetBrains Mono", "Fira Code", monospace',
  '--font-body': '"DM Sans", sans-serif',
  '--radius': '10px',

  fontFamily: 'var(--font-body)',
  color: 'var(--text)',
  maxWidth: '960px',
  margin: '0 auto',
  padding: '2rem 1rem',
  display: 'grid',
  gap: '1.5rem',

  '& *': { boxSizing: 'border-box' },
  '& input': {
    width: '100%',
    background: 'rgba(255,255,255,.05)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '.6rem .9rem',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '.85rem',
    outline: 'none',
    transition: 'border-color .2s',
    '&:focus': { borderColor: 'var(--accent)' }
  }
}));

const Card = styled(Box)({
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '1.5rem',
});

const CardTitle = styled(Typography)({
  fontSize: '.7rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.1em',
  color: 'var(--muted)',
  marginBottom: '1rem',
});

export default function VideoPage() {
  // ── Estados do React ──
  const [srvUrl, setSrvUrl] = useState('http://localhost:3000');
  const [room, setRoom] = useState('sala-01');

  const [dotWs, setDotWs] = useState('muted');
  const [dotRoom, setDotRoom] = useState('muted');
  const [dotPeer, setDotPeer] = useState('muted');

  const [connectDisabled, setConnectDisabled] = useState(false);
  const [cameraDisabled, setCameraDisabled] = useState(true);
  const [callDisabled, setCallDisabled] = useState(true);
  const [hangupDisabled, setHangupDisabled] = useState(true);

  const [showLocalPh, setShowLocalPh] = useState(true);
  const [showRemotePh, setShowRemotePh] = useState(true);

  const [logs, setLogs] = useState([]);

  // ── Referências de Instância (WebRTC & Sinalização) ──
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const currentRoomRef = useRef('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // ── Configuração ICE ──
  const iceConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // ── Helpers ──
  const uid = () => Math.random().toString(36).slice(2, 9);
  const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

  const addLog = (msg, type = '') => {
    setLogs(prev => [...prev, { id: uid(), time: now(), msg, type }]);
  };

  useEffect(() => {
    addLog('Pronto. Configure o servidor e clique em Conectar.', 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (event, payload = {}) => {
    if (!socketRef.current || !socketRef.current.connected) return;
    socketRef.current.emit(event, payload);
  };

  // ── Conexão com o Servidor de Sinalização ──
  const handleConnect = () => {
    const url = srvUrl.trim();
    currentRoomRef.current = room.trim();

    const socket = io(url);
    socketRef.current = socket;

    setDotWs('yellow');
    addLog(`Conectando em ${url}…`, 'info');

    socket.on('connect', () => {
      setDotWs('green');
      addLog('Socket.IO conectado!', 'success');

      socket.emit('join-room', { room: currentRoomRef.current });

      setDotRoom('green');
      addLog(`Entrou na sala "${currentRoomRef.current}"`, 'success');

      setConnectDisabled(true);
      setCameraDisabled(false);
    });

    socket.on('offer', async ({ offer }) => {
      addLog('Offer recebida — respondendo…', 'info');
      try {
        await ensurePeerConnection();
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);

        send('answer', { answer, room: currentRoomRef.current });
      } catch (err) {
        addLog(`Erro ao processar Offer: ${err.message}`, 'error');
      }
    });

    socket.on('answer', async ({ answer }) => {
      addLog('Answer recebida', 'info');
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        addLog(`Erro ao aplicar Answer: ${err.message}`, 'error');
      }
    });

    socket.on('candidate', async ({ candidate }) => {
      if (pcRef.current && candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          addLog('ICE candidate adicionado', '');
        } catch (err) {
          addLog(`Erro ao adicionar ICE: ${err.message}`, 'error');
        }
      }
    });

    socket.on('disconnect', () => {
      setDotWs('red');
      setDotRoom('red');
      addLog('Socket desconectado', 'error');

      setConnectDisabled(false);
      setCameraDisabled(true);
      setCallDisabled(true);
    });

    socket.on('connect_error', () => {
      addLog('Erro de conexão no Socket.IO', 'error');
      setDotWs('red');
    });
  };

  // ── PeerConnection ──
  const ensurePeerConnection = async () => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;
    setDotPeer('yellow');
    addLog('PeerConnection criada', 'info');

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send('candidate', { candidate, room: currentRoomRef.current });
    };

    pc.ontrack = ({ streams }) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = streams[0];
      setShowRemotePh(false);
      setDotPeer('green');
      addLog('Stream remoto recebido 🎉', 'success');
    };

    pc.onconnectionstatechange = () => {
      addLog(`Peer state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') setDotPeer('green');
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setDotPeer('red');
    };
  };

  // ── Câmera ──
  const handleStartCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setShowLocalPh(false);
      addLog('Câmera e microfone ativos', 'success');

      setCallDisabled(false);
      setCameraDisabled(true);
      setHangupDisabled(false);
    } catch (e) {
      addLog(`Câmera negada: ${e.message}`, 'error');
    }
  };

  // ── Ligar ──
  const handleCall = async () => {
    await ensurePeerConnection();
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    send('offer', { offer, room: currentRoomRef.current });
    addLog('Offer enviada — aguardando resposta…', 'info');
    setCallDisabled(true);
  };

  // ── Desligar ──
  const handleHangup = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setShowLocalPh(true);
    setShowRemotePh(true);
    setDotPeer('muted');

    setHangupDisabled(true);
    setCallDisabled(true);
    setCameraDisabled(false);

    addLog('Chamada encerrada', 'warn');
  };

  return (
    <PageWrapper>
      <HeaderComponent
        icon="📹"
        title="WebRTC · Chamada de Vídeo"
        description="Node.js Socket.IO backend · React.js Socket.IO frontend"
      />

      {/* Seção Conexão */}
      <Card>
        <CardTitle>Conexão</CardTitle>

        <StatusComponent
          dotWs={dotWs}
          dotRoom={dotRoom}
          dotPeer={dotPeer} />

        <ConectionComponent
          srvUrl={srvUrl}
          setSrvUrl={setSrvUrl}
          room={room}
          setRoom={setRoom}
          handleConnect={handleConnect}
          dotWs={dotWs}
          connectDisabled={connectDisabled} />

        <ActionsComponent
          cameraDisabled={cameraDisabled}
          callDisabled={callDisabled}
          hangupDisabled={hangupDisabled}
          handleStartCamera={handleStartCamera}
          handleCall={handleCall}
          handleHangup={handleHangup} />
      </Card>

      {/* Seção Vídeos */}
      <VideoGridComponent
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        showLocalPh={showLocalPh}
        showRemotePh={showRemotePh} />

      {/* Log */}
      <Card>
        <CardTitle>Log</CardTitle>
        <LogComponent logs={logs} onClear={() => setLogs([])} />
      </Card>
    </PageWrapper>
  );
}
