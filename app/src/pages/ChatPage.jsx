import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Box, Typography, styled } from '@mui/material';
import HeaderComponent from '../components/HeaderComponent';
import StatusComponent from '../components/StatusComponent';
import ConectionComponent from '../components/ConectionComponent';
import LogComponent from '../components/LogComponent';

// ── Estilização Baseada no style.css fornecido ──
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

export default function ChatPage() {
  // ── Estados de Conexão e Configurações ──
  const [srvUrl, setSrvUrl] = useState('http://localhost:3000');
  const [username, setUsername] = useState('Usuário Anônimo');
  const [room, setRoom] = useState('sala-01');
  const [isConnected, setIsConnected] = useState(false);
  
  const [dotWs, setDotWs] = useState('muted');
  const [dotRoom, setDotRoom] = useState('muted');
  const [dotPeer, setDotPeer] = useState('muted');

  // ── Estados do Chat e Participantes ──
  const [participants, setParticipants] = useState(new Map()); // id -> name
  const [privateTarget, setPrivateTarget] = useState(null); // id ou null (grupo)
  const [messages, setMessages] = useState([]); // Array de objetos de mensagem
  const [messageText, setMessageText] = useState('');
  const [logs, setLogs] = useState([]);

  // ── Estados de Gravação de Mídia ──
  const [isRecording, setIsRecording] = useState(false);
  const [recLabel, setRecLabel] = useState('Gravando...');

  // ── Referências de Instância (WebRTC, Sockets e Fluxos) ──
  const socketRef = useRef(null);
  const peersRef = useRef({});         // { socketId: RTCPeerConnection }
  const dataChannelsRef = useRef({});  // { socketId: RTCDataChannel }
  const peerNamesRef = useRef({});     // { socketId: username }
  const fileTransfersRef = useRef({}); // { transferId: { chunks, received... } }
  const fileInputRef = useRef(null);

  // Mídias
  const mediaRecorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recStreamRef = useRef(null);
  const recTimerIntervalRef = useRef(null);

  // ── Constantes e Configurações Globais do app.js ──
  const CHUNK_SIZE = 64 * 1024; // 64KB
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };

  const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

  const addLog = (msg, type = '') => {
    setLogs(prev => [...prev, { id: Math.random().toString(36).substring(7), time: now(), msg, type }]);
  };

  const updatePeerStatusDot = () => {
    const activePeers = Object.keys(dataChannelsRef.current).filter(
      id => dataChannelsRef.current[id].readyState === 'open'
    ).length;
    if (activePeers > 0) {
      setDotPeer('green');
    } else {
      setDotPeer('yellow');
    }
  };

  // ── Inicialização do Componente ──
  useEffect(() => {
    addLog('Pronto para conexões em grupo. Configure o servidor e conecte-se.', 'info');
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      clearInterval(recTimerIntervalRef.current);
    };
  }, []);

  // ── Conexão Socket.io & WebRTC Multi-Peer ──
  const handleConnect = () => {
    const socket = io(srvUrl, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });
    socketRef.current = socket;
    setDotWs('yellow');
    addLog('Conectando ao sinalizador...', 'info');

    socket.on('connect', () => {
      setDotWs('green');
      addLog('Conectado ao servidor de sinalização!', 'success');
      socket.emit('join-room', { room, username });
      setDotRoom('green');
      addLog(`Você entrou como "${username}" no grupo: "${room}"`, 'success');
      setIsConnected(true);
    });

    socket.on('user-connected', async ({ id, username: pName }) => {
      peerNamesRef.current[id] = pName;
      setParticipants(prev => new Map(prev).set(id, pName));
      addLog(`${pName} entrou no grupo. Criando conexão direta...`, 'info');
      await initPeer(id, true);
    });

    socket.on('offer', async ({ offer, from, username: pName }) => {
      if (!offer) return;
      peerNamesRef.current[from] = pName;
      setParticipants(prev => new Map(prev).set(from, pName));
      addLog(`Conectando de forma direta com ${pName}...`, 'info');
      
      const pc = await initPeer(from, false);
      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { answer, to: from, room });
      } catch (err) {
        addLog(`Erro ao responder oferta: ${err.message}`, 'error');
      }
    });

    socket.on('answer', async ({ answer, from, username: pName }) => {
      if (pName) {
        peerNamesRef.current[from] = pName;
        setParticipants(prev => new Map(prev).set(from, pName));
      }
      const pc = peersRef.current[from];
      if (pc && answer) {
        try { await pc.setRemoteDescription(answer); }
        catch (err) { addLog(`Erro ao aplicar resposta: ${err.message}`, 'error'); }
      }
    });

    socket.on('candidate', async ({ candidate, from }) => {
      const pc = peersRef.current[from];
      if (pc && candidate) {
        try { await pc.addIceCandidate(candidate); }
        catch (err) { console.error('Erro ICE:', err); }
      }
    });

    socket.on('user-disconnected', ({ id, username: pName }) => {
      addLog(`${pName || 'Um participante'} saiu do grupo.`, 'warn');
      setParticipants(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      closePeerConnection(id);
      delete peerNamesRef.current[id];
      if (privateTarget === id) setPrivateTarget(null);
    });

    socket.on('disconnect', () => {
      setDotWs('red'); setDotRoom('red'); setDotPeer('red');
      addLog('Você foi desconectado.', 'error');
      setIsConnected(false);
      Object.keys(peersRef.current).forEach(closePeerConnection);
    });
  };

  const initPeer = async (userId, isInitiator) => {
    if (peersRef.current[userId]) closePeerConnection(userId);

    const pc = new RTCPeerConnection(rtcConfig);
    peersRef.current[userId] = pc;

    if (isInitiator) {
      const dc = pc.createDataChannel('chat-group');
      setupDataChannel(userId, dc);
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(userId, event.channel);
      };
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('candidate', { candidate: e.candidate, to: userId });
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
        socketRef.current.emit('offer', { offer, to: userId });
      } catch (err) { addLog(`Erro ao criar oferta para ${userId}`, 'error'); }
    }

    return pc;
  };

  const setupDataChannel = (userId, channel) => {
    dataChannelsRef.current[userId] = channel;

    channel.onopen = () => {
      addLog(`Conexão direta P2P estabelecida com ${peerNamesRef.current[userId] || userId} 🚀`, 'success');
      updatePeerStatusDot();
    };

    channel.onclose = () => {
      closePeerConnection(userId);
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          const senderRealName = peerNamesRef.current[userId] || "Membro do Grupo";

          if (msg.type === 'text') {
            setMessages(prev => [...prev, { id: Math.random(), type: 'text', sender: 'peer', senderName: senderRealName, data: msg.data }]);
          }

          if (msg.type === 'private') {
            setMessages(prev => [...prev, { id: Math.random(), type: 'private', sender: 'peer', senderName: senderRealName, data: msg.data }]);
          }

          if (msg.type === 'file-start') {
            fileTransfersRef.current[msg.transferId] = {
              chunks: [], received: 0, total: msg.size, name: msg.name, mimeType: msg.mimeType, senderId: userId
            };
            addLog(`Recebendo "${msg.name}" de ${senderRealName}...`, 'info');
          }

          if (msg.type === 'file-end') {
            const transfer = fileTransfersRef.current[msg.transferId];
            if (!transfer) return;
            const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
            setMessages(prev => [...prev, {
              id: Math.random(), type: 'file', sender: 'peer', senderName: senderRealName, blob, name: transfer.name, mimeType: transfer.mimeType
            }]);
            addLog(`"${transfer.name}" recebido com sucesso!`, 'success');
            delete fileTransfersRef.current[msg.transferId];
          }
        } catch (e) { console.error(e); }
      } else {
        const activeTransfer = Object.values(fileTransfersRef.current).find(t => t.senderId === userId);
        if (activeTransfer) {
          activeTransfer.chunks.push(event.data);
          activeTransfer.received += event.data.byteLength;
        }
      }
    };
  };

  const closePeerConnection = (userId) => {
    if (dataChannelsRef.current[userId]) {
      dataChannelsRef.current[userId].close();
      delete dataChannelsRef.current[userId];
    }
    if (peersRef.current[userId]) {
      peersRef.current[userId].close();
      delete peersRef.current[userId];
    }
    updatePeerStatusDot();
  };

  // ── Lógica de Envio de Mensagens de Texto ──
  const handleSendMessage = () => {
    if (!messageText.trim()) return;

    if (privateTarget) {
      const dc = dataChannelsRef.current[privateTarget];
      if (!dc || dc.readyState !== 'open') {
        addLog(`Não foi possível enviar: peer desconectado.`, 'error');
        return;
      }
      dc.send(JSON.stringify({ type: 'private', data: messageText }));
      setMessages(prev => [...prev, { id: Math.random(), type: 'private', sender: 'me', senderName: 'Você', data: messageText }]);
    } else {
      const packet = JSON.stringify({ type: 'text', data: messageText });
      let sent = 0;
      Object.values(dataChannelsRef.current).forEach(dc => {
        if (dc.readyState === 'open') { dc.send(packet); sent++; }
      });
      setMessages(prev => [...prev, { id: Math.random(), type: 'text', sender: 'me', senderName: 'Você', data: messageText }]);
      if (!sent) addLog('Nenhum peer conectado para receber a mensagem.', 'warn');
    }
    setMessageText('');
  };

  // ── Lógica de Transmissão de Arquivos e Mídias ──
  const handleSendFile = async (file) => {
    if (file.size > MAX_FILE_SIZE) {
      addLog(`"${file.name}" bloqueado — tamanho excede o limite de 100 MB.`, 'error');
      return;
    }

    const transferId = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    const openChannels = Object.values(dataChannelsRef.current).filter(dc => dc.readyState === 'open');

    if (openChannels.length === 0) {
      addLog('Nenhum peer conectado para receber o arquivo.', 'warn');
      return;
    }

    addLog(`Enviando "${file.name}" (${(file.size / 1024).toFixed(1)} KB)...`, 'info');

    const startMsg = JSON.stringify({ type: 'file-start', transferId, name: file.name, mimeType: file.type, size: file.size });
    const endMsg = JSON.stringify({ type: 'file-end', transferId });

    for (const dc of openChannels) {
      dc.send(startMsg);
      for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
        const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
        while (dc.bufferedAmount > 1 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 20));
        }
        dc.send(chunk);
      }
      dc.send(endMsg);
    }

    const blob = new Blob([arrayBuffer], { type: file.type });
    setMessages(prev => [...prev, { id: Math.random(), type: 'file', sender: 'me', senderName: 'Você', blob, name: file.name, mimeType: file.type }]);
    addLog(`"${file.name}" enviado!`, 'success');
  };

  // ── Mecanismo de Gravação de Áudio/Vídeo ──
  const startRecording = async (mode) => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(mode === 'video' ? { video: true, audio: true } : { audio: true });
      recStreamRef.current = stream;
    } catch (err) {
      addLog(`Erro ao acessar mídia: ${err.message}`, 'error');
      return;
    }

    recChunksRef.current = [];
    const mimeType = mode === 'video' 
      ? ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t))
      : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));

    if (!mimeType) {
      addLog('Formato de gravação não suportado pelo navegador.', 'error');
      recStreamRef.current.getTracks().forEach(t => t.stop());
      return;
    }

    const recorder = new MediaRecorder(recStreamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      recStreamRef.current.getTracks().forEach(t => t.stop());
      clearInterval(recTimerIntervalRef.current);
      setIsRecording(false);

      const blob = new Blob(recChunksRef.current, { type: mimeType });
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `${mode}-${Date.now()}.${ext}`, { type: mimeType });
      
      await handleSendFile(file);
    };

    let seconds = 0;
    setIsRecording(true);
    setRecLabel(`${mode === 'video' ? '🎥 Gravando vídeo' : '🎤 Gravando áudio'} · 0s`);
    
    recTimerIntervalRef.current = setInterval(() => {
      seconds++;
      setRecLabel(`${mode === 'video' ? '🎥 Gravando vídeo' : '🎤 Gravando áudio'} · ${seconds}s`);
    }, 1000);

    recorder.start(100);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Renderizador condicional do conteúdo das mensagens (Texto ou Anexos/Mídias)
  const renderMessageContent = (msg) => {
    if (msg.type === 'text' || msg.type === 'private') {
      return <p style={{ margin: 0 }}>{msg.data}</p>;
    }

    const url = URL.createObjectURL(msg.blob);
    if (msg.mimeType.startsWith('image/')) {
      return <img src={url} alt={msg.name} style={{ maxWidth: '220px', maxHeight: '200px', borderRadius: '8px', display: 'block', marginTop: '6px', cursor: 'pointer' }} onClick={() => window.open(url)} />;
    } else if (msg.mimeType.startsWith('video/')) {
      return <video src={url} controls style={{ maxWidth: '260px', borderRadius: '8px', display: 'block', marginTop: '6px' }} />;
    } else if (msg.mimeType.startsWith('audio/')) {
      return <audio src={url} controls style={{ maxWidth: '260px', borderRadius: '8px', display: 'block', marginTop: '6px' }} />;
    } else {
      return <a href={url} download={msg.name} style={{ color: '#7eb8f7', display: 'block', marginTop: '4px' }}>📥 {msg.name}</a>;
    }
  };

  return (
    <PageWrapper>
      <HeaderComponent 
        icon="💬"
        title="WebRTC · Chat Peer-to-Peer" 
        description="Node.js Socket.IO backend · WebRTC DataChannel frontend"
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
          username={username}
          setUsername={setUsername}
          room={room}
          setRoom={setRoom}
          handleConnect={handleConnect}
          dotWs={dotWs} />
      </Card>

      {/* Seção Central de Mensagens e Participantes */}
      <Card>
        <CardTitle>Mensagens</CardTitle>
        <Box sx={{ display: 'flex', gap: '10px', alignItems: 'stretch', flexDirection: { xs: 'column', sm: 'row' } }}>
          
          {/* Lista de Participantes Laterais */}
          <Box sx={{ width: { xs: '100%', sm: '140px' }, flexShrink: 0, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: '3px', overflowY: 'auto', maxHeight: '300px' }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', padding: '2px 6px 6px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>Participantes</div>
            
            <Box onClick={() => setPrivateTarget(null)} className={`user-item ${!privateTarget ? 'active' : ''}`} sx={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text)', transition: 'background 0.15s', '&.active': { background: 'rgba(0, 229, 255, 0.12)', color: 'var(--accent)', fontWeight: 600 } }}>
              <span>👥</span><span>Todos</span>
            </Box>

            <Box className="user-item user-self" sx={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', borderRadius: '7px', fontSize: '0.8rem', color: 'var(--text)', opacity: 0.5 }}>
              <span>🟢</span><span>{username} (Você)</span>
            </Box>

            {Array.from(participants.entries()).map(([id, name]) => (
              <Box key={id} onClick={() => setPrivateTarget(id)} className={`user-item ${privateTarget === id ? 'active' : ''}`} sx={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text)', '&.active': { background: 'rgba(0, 229, 255, 0.12)', color: 'var(--accent)', fontWeight: 600 } }}>
                <span>👤</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              </Box>
            ))}
          </Box>

          {/* Container das Mensagens */}
          <Box sx={{ height: '300px', width: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.5rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            {messages.map(msg => (
              <Box key={msg.id} sx={{ display: 'flex', width: '100%', justifyContent: msg.sender === 'me' ? 'flex-end' : 'flex-start' }}>
                <Box sx={{ maxWidth: '75%', padding: '0.6rem 0.9rem', borderRadius: '12px', fontSize: '0.9rem', lineHeight: 1.4, position: 'relative', wordBreak: 'break-word', background: msg.sender === 'me' ? 'linear-gradient(135deg, var(--accent2), rgba(124, 58, 237, 0.6))' : 'var(--border)', color: msg.sender === 'me' ? '#fff' : 'var(--text)', borderBottomRightRadius: msg.sender === 'me' ? '2px' : '12px', borderBottomLeftRadius: msg.sender === 'peer' ? '2px' : '12px' }}>
                  {msg.type === 'private' && <span style={{ display: 'inline-block', fontSize: '10px', fontWeight: 700, background: 'rgba(124,58,237,0.3)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)', borderRadius: '5px', padding: '1px 5px', marginBottom: '4px', letterSpacing: '.05em' }}>🔒 PRIVADO</span>}
                  <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: msg.sender === 'me' ? 'var(--yellow)' : 'var(--accent)', textAlign: msg.sender === 'me' ? 'right' : 'left', marginBottom: '0.15rem' }}>{msg.senderName}</span>
                  {renderMessageContent(msg)}
                  <span style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.4)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{now()}</span>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Card>

      {/* Formulário Inferior de Envio */}
      <Card>
        <CardTitle>Enviar mensagem</CardTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.75rem', alignItems: 'end' }}>
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: 'var(--muted)', marginBottom: '.35rem' }}>Mensagem</label>
            
            {privateTarget && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent2)', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
                <span>🔒 Para: <strong>{participants.get(privateTarget) || privateTarget}</strong></span>
                <button onClick={() => setPrivateTarget(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '13px' }}>✕</button>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <input value={messageText} onChange={e => setMessageText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} className={privateTarget ? 'private' : ''} style={{ borderColor: privateTarget ? 'var(--accent2)' : '', boxShadow: privateTarget ? '0 0 0 2px rgba(124,58,237,0.25)' : '' }} placeholder={privateTarget ? `Mensagem privada para ${participants.get(privateTarget)}...` : "Digite sua mensagem..."} disabled={!isConnected} />
              
              <button onClick={() => fileInputRef.current.click()} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '8px' }} disabled={!isConnected} title="Anexar arquivos">
                📎
                <input type="file" ref={fileInputRef} onChange={e => handleSendFile(e.target.files[0])} style={{ display: 'none' }} />
              </button>

              <button onClick={() => startRecording('audio')} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', color: isRecording ? '#ef4444' : 'var(--text)', borderRadius: '8px' }} disabled={!isConnected} title="Gravar Áudio">🎤</button>
              <button onClick={() => startRecording('video')} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', color: isRecording ? '#ef4444' : 'var(--text)', borderRadius: '8px' }} disabled={!isConnected} title="Gravar Vídeo">🎥</button>
              
              <button className="btn btn-primary" onClick={handleSendMessage} disabled={!isConnected} style={{ padding: '.65rem 1.4rem', border: 'none', borderRadius: '8px', fontWeight: 600, background: 'linear-gradient(135deg, var(--accent2), var(--accent))', color: '#fff' }}>Enviar</button>
            </Box>

            {isRecording && (
              <Box sx={{ display: 'flex', marginTop: '6px', fontSize: '12px', color: '#ef4444', fontFamily: 'var(--font-mono)', alignItems: 'center', gap: '6px' }}>
                <span style={{ animation: 'blink 1s infinite' }}>⏺</span>
                <span>{recLabel}</span>
              </Box>
            )}
          </div>
        </Box>
        {!isConnected && <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: '0.95rem' }}>Conecte-se a uma sala para começar a conversar.</p>}
      </Card>

      {/* Log */}
      <Card>
        <CardTitle>Log</CardTitle>
        <LogComponent logs={logs} onClear={() => setLogs([])} />
      </Card>
    </PageWrapper>
  );
}