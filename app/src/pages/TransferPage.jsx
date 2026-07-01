import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Box, Typography, styled } from '@mui/material';
import HeaderComponent from '../components/HeaderComponent';
import StatusComponent from '../components/StatusComponent';
import ConectionComponent from '../components/ConectionComponent';
import InputsSendFiles from '../components/InputsSendFiles';
import TransferComponent from '../components/TransferComponent';
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

export default function TransferPage() {
  // ── Estados do React ──
  const [srvUrl, setSrvUrl] = useState('http://localhost:3000');
  const [room, setRoom] = useState('sala-01');
  const [isConnected, setIsConnected] = useState(false);
  
  const [dotWs, setDotWs] = useState('muted');
  const [dotRoom, setDotRoom] = useState('muted');
  const [dotPeer, setDotPeer] = useState('muted');

  const [logs, setLogs] = useState([]);
  const [sendQueue, setSendQueue] = useState(new Map());
  const [receiveQueue, setReceiveQueue] = useState(new Map());

  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [totalSendSize, setTotalSendSize] = useState('0 MB');
  const [sendCountText, setSendCountText] = useState('');

  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [totalReceiveSize, setTotalReceiveSize] = useState('0 MB');
  const [receiveCountText, setReceiveCountText] = useState('');
  const [acceptBtnText, setAcceptBtnText] = useState('Aceitar e Salvar');
  const [acceptDisabled, setAcceptDisabled] = useState(false);

  // ── Referências de Instância (WebRTC & Fluxo) ──
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const sendFilesListRef = useRef([]); // Armazena objetos { file, id, relativePath }
  const startSendingResolverRef = useRef(null); // Libera a promise no handleSendFiles quando o evento 'start-sending' chegou

  // Maps para manipulação O(1) dentro das Callbacks
  const receiveMapRef = useRef(new Map());
  const receivedAckResolversRef = useRef(new Map());
  // Guarda quantos bytes o arquivo tinha quando atualizou a UI pela última vez
  const lastBytesUiUpdateRef = useRef(new Map()); // id -> bytes (number)
  
  const targetDirHandleRef = useRef(null);
  const sendAbortControllerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Contadores mutáveis para evitar re-triggers cíclicos de render
  const countersRef = useRef({
    expectedFilesCount: 0, 
    expectedTotalSize: 0, 
    receivedFilesCount: 0,
    sendFilesCount: 0, 
    sendFilesTotal: 0, 
    sendStartTime: 0, 
    receiveStartTime: 0, 
    chunkSize: 250 * 1024, // 250 KB por padrão
    bufferHighWater: 4 * 1024 * 1024, // 4 MB
    bufferLowWater: 512 * 1024, // 512 KB
    peerMode: 'memory',
    maxFileSize: 1024 * 1024 * 256, // 256 MB -- limite de envio em memória
    peerRecievedMode: 'memory',
    maxRecievedFileSize: 1024 * 1024 * 256 // 256 MB -- limite de envio em memória
  });

  // ── Constantes ──
  const NUM_BUFFER_HIGH_WATER = 16                // 250 KB * 16 = 4 MB
  const NUM_BUFFER_LOW_WATER = 1                  // 512 KB * 1 = 512 KB 
  const MB_UPDATE_PROGRESS = 5 * 1024 * 1024;     // 5 MB para atualizar o progresso na interface

  const TEXT_DECODER = new TextDecoder(); // Decodificador UTF-8 para handleChunk

  // ── Helpers de Formatação ──
  const fmtMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';
  const uid = () => Math.random().toString(36).slice(2, 9);
  const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

  const addLog = (msg, type = '') => {
    setLogs(prev => [...prev, { id: uid(), time: now(), msg, type }]);
  };

  useEffect(() => {
    // eslint-disable-next-line functional/no-expression-statements
    addLog('Pronto. Configure o servidor e clique em Conectar.', 'info');
  }, []);

  const setSendQueueMap = (id, overwrites) => {
    setSendQueue(prev => {
      const next = new Map(prev);
      const currentItem = next.get(id);
      if (currentItem) {
        next.set(id, { ...currentItem, ...overwrites });
      }
      return next;
    });
  }

  const setRecieveQueueMap = (id, overwrites) => {
    setReceiveQueue(prev => {
      const next = new Map(prev);
      const currentItem = next.get(id);
      if (currentItem) {
        next.set(id, { ...currentItem, ...overwrites });
      }
      return next;
    });
  }

  // ── Controle do Wake Lock ──
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        addLog('Modo de suspensão bloqueado para manter transferência ativa 💡', 'info');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      addLog('Modo de suspensão liberado 💡 ', 'info');
      wakeLockRef.current.release().then(() => { wakeLockRef.current = null; });
    }
  };

  // ── Configuração WebRTC ──
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };

  // ── Conexão com o Servidor de Sinalização ──
  const handleConnect = async () => {
    const socket = io(srvUrl, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });
    socketRef.current = socket;
    setDotWs('yellow');

    socket.on('connect', async () => {
      setDotWs('green');
      addLog('Conectado ao servidor de sinalização!', 'success');
      socket.emit('join-room', { room });
      setDotRoom('green');
      addLog(`Entrou na sala "${room}"`, 'success');

      if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') return;
      await initPeer(room);
    });

    socket.on('user-connected', async () => {
      addLog('Peer entrou na sala — iniciando offer…', 'info');
      const dc = pcRef.current.createDataChannel('transfer-files');
      dc.binaryType = 'arraybuffer';
      dataChannelRef.current = dc;
      setupDataChannel();
      
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socket.emit('offer', { offer, room });
    });

    socket.on('offer', async ({ offer }) => {
      try {
        await pcRef.current.setRemoteDescription(offer);
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        socket.emit('answer', { answer, room });
      } catch (err) { console.error(err); }
    });

    socket.on('answer', async ({ answer }) => {
      try { 
        await pcRef.current.setRemoteDescription(answer); 
      } catch(err) { console.error(err); }
    });

    socket.on('candidate', async ({ candidate }) => {
      if (pcRef.current && candidate) await pcRef.current.addIceCandidate(candidate);
    });

    socket.on('disconnect', () => {
      setDotWs('red'); setDotRoom('red');
    });
  };

  const initPeer = async (currentRoom) => {
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;
    addLog('PeerConnection criada', 'info');

    pc.ondatachannel = (event) => {
      dataChannelRef.current = event.channel;
      dataChannelRef.current.binaryType = 'arraybuffer';
      setupDataChannel();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('candidate', { candidate: e.candidate, room: currentRoom });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      addLog(`Peer: ${s}`, 'info');
      if (s === 'connecting') setDotPeer('yellow');
      if (s === 'connected') setDotPeer('green');
      if (s === 'disconnected' || s === 'failed') setDotPeer('red');
    };
  };

  const setupDataChannel = () => {
    const dc = dataChannelRef.current;
    dc.onopen = async () => {
      addLog('Canal WebRTC aberto', 'success');
      setIsConnected(true);

      const negotiatedMax = pcRef.current.sctp?.maxMessageSize || (64 * 1024);
      countersRef.current.chunkSize = Math.max(16 * 1024, Math.min(negotiatedMax - 6144, 1024 * 1024));

      // Calcula os watermarks baseado no chunkSize real
      countersRef.current.bufferHighWater = countersRef.current.chunkSize * NUM_BUFFER_HIGH_WATER;
      countersRef.current.bufferLowWater  = countersRef.current.chunkSize * NUM_BUFFER_LOW_WATER;

      addLog(`Tamanho de chunk: ${fmtMB(countersRef.current.chunkSize)} · High water: ${fmtMB(countersRef.current.bufferHighWater)} · Low water: ${fmtMB(countersRef.current.bufferLowWater)}`, 'info');

      if(typeof window.showDirectoryPicker === 'function') {
        countersRef.current.peerMode = 'disk';
        countersRef.current.maxFileSize = 0; // N/A
      } else if (typeof navigator.storage?.getDirectory === 'function') {
        countersRef.current.peerMode = 'opfs';
        const estimate = await navigator.storage.estimate();
        countersRef.current.maxFileSize = estimate.quota - estimate.usage;
      } else {
        countersRef.current.peerMode = 'memory';
      }

      dc.send(JSON.stringify({ type: 'received-mode', mode: countersRef.current.peerMode, maxFileSize: countersRef.current.maxFileSize }));
    };

    dc.onclose = () => {
      addLog('Canal WebRTC fechado', 'error');
      setIsConnected(false);
      setShowSendConfirm(false);
      
      receivedAckResolversRef.current.forEach(resolve => resolve());
      receivedAckResolversRef.current.clear();
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleControlMessage(JSON.parse(event.data));
      } else {
        handleChunk(event.data);
      }
    };
  };

  // ── Sinalização e Mensagens de Controle ──
  const handleControlMessage = async (msg) => {
    switch (msg.type) {
      case 'received-mode':
        countersRef.current.peerRecievedMode = msg.mode;
        countersRef.current.maxRecievedFileSize = msg.maxFileSize;
        addLog(`Modo de recepção remoto: ${msg.mode} máximo do tamanho do arquivo - ${fmtMB(msg.maxFileSize)} `, 'info');
        break;

      case 'offer-files':
        countersRef.current.expectedFilesCount = msg.data.total;
        countersRef.current.expectedTotalSize = msg.data.size;
        countersRef.current.receivedFilesCount = 0;
        setReceiveCountText(`0 de ${msg.data.total}`);
        addLog(`Lote de ${msg.data.total} arquivo(s) · ${fmtMB(msg.data.size)}`, 'send');

        if (countersRef.current.peerMode === 'disk') {
          setTotalReceiveSize(fmtMB(msg.data.size));
          setShowAcceptConfirm(true);
          addLog(`Aguardando aceite — ${fmtMB(msg.data.size)} 🔔 `, 'warn');
        } else {
          await requestWakeLock();
          countersRef.current.receiveStartTime = Date.now();
          // Modo memória aceita na hora: avisa o remetente imediatamente
          dataChannelRef.current.send(JSON.stringify({ type: 'start-sending' }));
        }
        break;
      
      // Libera a promessa travada no handleSendFiles
      case 'start-sending': {
        if (startSendingResolverRef.current) {
          startSendingResolverRef.current(); 
          startSendingResolverRef.current = null;
        }
        break;
      }

      // Erro de Transferência
      case 'files-rejected':
        addLog(`Transferência rejeitada: ${msg.data.error}`, 'error');
        if (sendAbortControllerRef.current) {
          sendAbortControllerRef.current.abort();

          // Atualiza a fila de envio com o erro de transferência
          setSendQueue(prev => {
            const next = new Map();
            
            prev.forEach((item, key) => {
              next.set(key, { ...item, status: 'error' });
            });
            
            return next;
          });

          addLog('Envios interrompidos.', 'error');
        }
        releaseWakeLock();
        break;

      // Erro de Arquivo
      case 'file-rejected':
        if (sendAbortControllerRef.current) {
          sendAbortControllerRef.current.abort();
          
          // Atualiza a fila de envio com o erro de transferência
          setSendQueueMap(msg.data.id, { status: 'error' }); 
        }

        addLog(`Arquivo rejeitado: ${msg.data.error}`, 'error');
        break;  

      // dados de um arquivo
      case 'meta': {
        const meta = msg.data;
        if (meta.size > countersRef.current.maxFileSize && ['memory', 'opfs'].includes(countersRef.current.peerMode)) {
          addLog(`${meta.name} grande demais para memória ou OPFS`, 'error');
          dataChannelRef.current.send(JSON.stringify({ type: 'file-rejected', data: { id: meta.id, error: 'file-too-big' } }));
          return;
        }
 
        // Adiciona o arquivo ao mapa de recebimento
        setReceiveQueue(prev => {
          const next = new Map(prev);
          next.set(meta.id, {
            id: meta.id,
            name: meta.name,
            size: meta.size,
            progress: 0,
            status: 'pending',
            sizeText: fmtMB(meta.size)
          });
          return next;
        });
        
        const entryObj = {
          meta, 
          id: meta.id, 
          buffers: [], 
          receivedSize: 0,
          isStreaming: false, 
          writable: null, 
          finalized: false,
          writeLock: Promise.resolve()
        };

        // salvando em disco no modo OPFS do firefox
        if (countersRef.current.peerMode === 'opfs') {
          entryObj.isStreaming = true;
          // Executa a abertura de arquivo em background de forma assíncrona
          entryObj.writeLock = (async () => {
            const root = await navigator.storage.getDirectory();
            // Cria o arquivo no disco isolado do Firefox
            entryObj.fileHandle = await root.getFileHandle(meta.id, { create: true });
          })();
        }

        receiveMapRef.current.set(meta.id, entryObj);
        break;
      }

      case 'received': {
        addLog(`Recebido confirmado: ${msg.data.name}`, 'success');
        countersRef.current.sendFilesCount++;
        setSendCountText(`${countersRef.current.sendFilesCount} de ${countersRef.current.sendFilesTotal}`);
        
        // Atualiza o mapa de envios
        setSendQueueMap(msg.data.id, { progress: 100, status: 'done' });

        const resolve = receivedAckResolversRef.current.get(msg.data.id);

        if (resolve) {
          resolve();
          receivedAckResolversRef.current.delete(msg.data.id);
        }
        break;
      }

      case 'finished': {
        const elapsed = ((Date.now() - countersRef.current.sendStartTime) / 1000 / 60).toFixed(2);
        addLog(`Transferência concluída: ${fmtMB(msg.data.size)} em ${elapsed}min`, 'success');
        releaseWakeLock();
        break;
      }

      default: break;
    }
  };

  // ── Processamento de Chunks Binários ──
  const handleChunk = async (buf) => {
    const view = new DataView(buf);
    const idLen = view.getUint32(0, true);
    const idStr = TEXT_DECODER.decode(new Uint8Array(buf, 4, idLen));
    const chunk = buf.slice(4 + idLen);

    const entry = receiveMapRef.current.get(idStr);
    if (!entry) return;

    // Atualiza contagem imediatamente, fora do writeLock
    entry.receivedSize += chunk.byteLength;
    const isLast = entry.receivedSize >= entry.meta.size;

    const pct = Math.min(100, (entry.receivedSize / entry.meta.size) * 100).toFixed(1);
    const ultimosBytesAtualizados = lastBytesUiUpdateRef.current.get(entry.id) || 0;

    // Condição: Atualiza se ultrapassou o gatilho, se for o primeiro chunk, ou se o arquivo terminou
    if (entry.receivedSize - ultimosBytesAtualizados >= MB_UPDATE_PROGRESS || entry.receivedSize === chunk.byteLength || entry.receivedSize >= entry.meta.size) {

      // Atualiza o estado do React (Dispara a UI do <li> específico)
      setRecieveQueueMap(entry.id, { 
        status: 'active', 
        progress: pct, 
        sizeText: `${pct}% · ${fmtMB(entry.receivedSize)} de ${fmtMB(entry.meta.size)}` 
      });
      
      // Guarda a marca atual de bytes para o próximo cálculo de delta
      lastBytesUiUpdateRef.current.set(entry.id, entry.receivedSize);
    }

    // I/O em disco na chain separada
    entry.writeLock = entry.writeLock
      .then(() => writeChunk(entry, chunk))
      .then(async () => {
        if (!entry.finalized && isLast) {
          entry.finalized = true;
          await finalizeReceive(entry);
        }
      })
      .catch(err => addLog(`Erro no fluxo de chunks: ${err.message}`, 'error'));
  };

  const writeChunk = async (entry, data) => {
    if (entry.isStreaming) {
      if (!entry.writable && entry.fileHandle) {
        entry.writable = await entry.fileHandle.createWritable();
        addLog(`Salvando "${entry.meta.name}" em disco…`, 'receive');
      }
      await entry.writable.write(data);
    } else {
      if (entry.buffers.length === 0) {
        addLog(`Salvando "${entry.meta.name}" em memória…`, 'receive');
      }
      entry.buffers.push(data);
    }
  };

  // ── Ações de envio ──
  const handleFileChange = (e, isFolder) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    for (const file of files) {
     
      const itemId = uid();
      const relativePath = isFolder ? file.webkitRelativePath : file.name;
      
       if (file.size > countersRef.current.maxRecievedFileSize && ['memory', 'opfs'].includes(countersRef.current.peerRecievedMode)) {
        addLog(`${file.name} grande demais para o par em memória ou opfs — pulado`, 'error');
        setSendQueue(prev => {
          const next = new Map(prev);
          next.set(itemId, { 
            id: itemId, 
            name: file.name, 
            size: file.size, 
            progress: 0, 
            status: 'error', 
            sizeText: `(pulado) ${fmtMB(file.size)}`
          });
          return next;
        });         
        continue;
      }

      sendFilesListRef.current.push({ file, id: itemId, relativePath });
      countersRef.current.expectedTotalSize += file.size;

      // Adiciona a fila de envio  
      setSendQueue(prev => {
        const next = new Map(prev);
        next.set(itemId, { 
          id: itemId, 
          name: file.name, 
          size: file.size, 
          progress: 0, 
          status: 'pending', 
          sizeText: fmtMB(file.size)
        });
        return next;
      });
    }
    
    setTotalSendSize(fmtMB(sendFilesListRef.current.reduce((a, b) => a + b.file.size, 0)));
    setShowSendConfirm(true);
  };

  const handleSendFiles = async (now) => {
    setShowSendConfirm(false);
    const toSend = [...sendFilesListRef.current];
    sendFilesListRef.current = [];
    if (toSend.length === 0) return;

    sendAbortControllerRef.current = new AbortController();
    countersRef.current.sendStartTime = now;

    dataChannelRef.current.send(JSON.stringify({
      type: 'offer-files',
      data: { total: toSend.length, size: toSend.reduce((a, b) => a + b.file.size, 0) }
    }));

    countersRef.current.sendFilesTotal = toSend.length;
    countersRef.current.sendFilesCount = 0;
    setSendCountText(`0 de ${toSend.length}`);

    for (const item of toSend) {
      dataChannelRef.current.send(JSON.stringify({
        type: 'meta',
        data: { name: item.file.name, size: item.file.size, type: item.file.type, id: item.id, relativePath: item.relativePath }
      }));
    }

    await requestWakeLock();

    addLog(`Aguardando confirmação de aceite do destinatário...`, 'warn');

    // Aguarda o destinatário autorizar o início do envio 
    await new Promise((resolve) => {
      startSendingResolverRef.current = resolve;
    });

    addLog(`Enviando ${toSend.length} arquivo(s) sequencialmente`, 'info');

    for (const item of toSend) {
      if (sendAbortControllerRef.current.signal.aborted) break;
      await sendSingleFile(item, sendAbortControllerRef.current.signal);
      if (sendAbortControllerRef.current.signal.aborted) break;

      await new Promise((resolve) => {
        receivedAckResolversRef.current.set(item.id, resolve);
        dataChannelRef.current.addEventListener('close', () => resolve(), { once: true });
      });
    }
    releaseWakeLock();
  };

  const sendSingleFile = ({ file, id }, signal) => {
    return new Promise((resolve) => {
      setSendQueueMap(id, { status: 'active' });

      (async () => {
        let offset = 0;
        const chunkSize = countersRef.current.chunkSize;
        
        const idBytes = new TextEncoder().encode(id);
        const idLen = idBytes.length;
        
        while (offset < file.size) {
          if (signal.aborted) {
            setSendQueueMap(id, { status: 'error', sizeText: '(cancelado)' });
            return resolve();
          }

          if (dataChannelRef.current.bufferedAmount > countersRef.current.bufferHighWater) {
            await waitForBufferDrain();
          }

          // ✅ Sem FileReader, sem onload, sem event loop overhead
          const raw = await file.slice(offset, offset + chunkSize).arrayBuffer();

          const buf = new Uint8Array(4 + idLen + raw.byteLength);
          new DataView(buf.buffer).setUint32(0, idLen, true);
          buf.set(idBytes, 4);
          buf.set(new Uint8Array(raw), 4 + idLen);

          if (dataChannelRef.current?.readyState === 'open') {
            dataChannelRef.current.send(buf.buffer);
          }

          offset += raw.byteLength;
          const pct = ((offset / file.size) * 100).toFixed(1);

          const ultimosBytesAtualizados = lastBytesUiUpdateRef.current.get(id) || 0;
          const delta = offset - ultimosBytesAtualizados;

          if (delta >= MB_UPDATE_PROGRESS || offset === raw.byteLength || offset >= file.size) {
            setSendQueueMap(id, {
              progress: pct,
              sizeText: `${pct}% · ${fmtMB(offset)} de ${fmtMB(file.size)}`,
            });
            lastBytesUiUpdateRef.current.set(id, offset);
          }
        }

        setSendQueueMap(id, { status: 'done', progress: 100, sizeText: fmtMB(file.size) });
        resolve();
      })();
    });
  };

  const waitForBufferDrain = () => {
    return new Promise((resolve) => {
      if (dataChannelRef.current.bufferedAmount <= countersRef.current.bufferLowWater) return resolve();
      dataChannelRef.current.bufferedAmountLowThreshold = countersRef.current.bufferLowWater;
      dataChannelRef.current.addEventListener('bufferedamountlow', () => resolve(), { once: true });
    });
  };

  // ── Ações de recebimento ──
  const handleAcceptFiles = async () => {
    setAcceptDisabled(true);
    setAcceptBtnText('Processando...');
    await requestWakeLock();
    countersRef.current.receiveStartTime = Date.now();

    try {
      if (!targetDirHandleRef.current) {
        targetDirHandleRef.current = await window.showDirectoryPicker();
        addLog(`Pasta destino: "${targetDirHandleRef.current.name}" 📁 `, 'info');
        dataChannelRef.current.send(JSON.stringify({ type: 'start-sending' }));
      }
    } catch (err) {
      addLog(`Erro ao abrir pasta: ${err.message}`, 'error');
      dataChannelRef.current.send(JSON.stringify({ type: 'files-rejected', data: { error: 'Pasta não selecionada' } }));
      setShowAcceptConfirm(false);
      setAcceptDisabled(false);
      setAcceptBtnText('Aceitar e Salvar');
      return;
    }

    // Mapeamento de ficheiros assíncronos
    const currentQueue = Array.from(receiveMapRef.current.values());

    for (const e of currentQueue) {
      try {
        const parts = (e.meta.relativePath || e.meta.name).split('/');
        const fileName = parts.pop();
        let dir = targetDirHandleRef.current;
        for (const part of parts) {
          if (part) dir = await dir.getDirectoryHandle(part, { create: true });
        }
        e.fileHandle = await dir.getFileHandle(fileName, { create: true });
        e.isStreaming = true;
      } catch {
        e.isStreaming = false;
      }
    }

    setShowAcceptConfirm(false);
    setAcceptDisabled(false);
    setAcceptBtnText('Aceitar e Salvar'); 
  };

  // ── Finalização de Recepção ──
  const finalizeReceive = async (entry) => {
    setRecieveQueueMap(entry.id, { status: 'finalizing' });
    
    dataChannelRef.current.send(JSON.stringify({ type: 'received', data: { name: entry.meta.name, id: entry.meta.id } }));
    receiveMapRef.current.delete(entry.meta.id);  
        
    if (countersRef.current.peerMode === 'opfs' && entry.writable) {
      try {
        await entry.writable.close(); // Fecha o fluxo de escrita de forma segura
        
        // 1. Resgata o arquivo final do disco virtual do Firefox
        const fileData = await entry.fileHandle.getFile();
        const url = URL.createObjectURL(fileData);
        
        // 2. Cria o gatilho de download nativo
        const a = Object.assign(document.createElement('a'), { 
          href: url, 
          download: entry.meta.relativePath || entry.meta.name 
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 3. Aguarda 2 segundos para dar tempo ao Firefox de iniciar o download 
        // antes de limpar a memória e o espaço em disco
        setTimeout(async () => {
          URL.revokeObjectURL(url); // Libera o ponteiro da memória
          try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(entry.id); // Apaga com segurança o arquivo do OPFS
          } catch (e) {
            console.warn(`Aviso ao limpar OPFS: ${e.message}`);
          }
        }, 2000); // 2000ms é um tempo extremamente seguro para lotes grandes de arquivos

        addLog(`${entry.meta.name} baixado via OPFS`, 'receive');
      } catch (err) {
        setRecieveQueueMap(entry.id, { status: 'error' });
        addLog(`Erro ao finalizar OPFS em "${entry.meta.name}": ${err.message}`, 'error');
      }
    } else if (entry.isStreaming && entry.writable) {
      try {
        await entry.writable.close();
        addLog(`${entry.meta.name} salvo em disco`, 'receive');
      } catch (err) {
        setRecieveQueueMap(entry.id, { status: 'error' });
        addLog(`Erro ao fechar "${entry.meta.name}": ${err.message}`, 'error');
      }
    } else {
      const blob = new Blob(entry.buffers, { type: entry.meta.type || 'application/octet-stream' });
      entry.buffers = []; // Limpa a referência imediatamente aqui!

      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: entry.meta.relativePath || entry.meta.name });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      addLog(`${entry.meta.name} baixado`, 'receive');
    }

    setRecieveQueueMap(entry.id, { status: 'done', progress: 100, sizeText: fmtMB(entry.meta.size) });
    
    countersRef.current.receivedFilesCount++;
    setReceiveCountText(`${countersRef.current.receivedFilesCount} de ${countersRef.current.expectedFilesCount}`);

    if (countersRef.current.expectedFilesCount > 0 && countersRef.current.receivedFilesCount >= countersRef.current.expectedFilesCount) {
      const elapsed = ((Date.now() - countersRef.current.receiveStartTime) / 1000 / 60).toFixed(2);
      addLog(`Transferência concluída: ${fmtMB(countersRef.current.expectedTotalSize)} em ${elapsed}min 🎉`, 'success');
      dataChannelRef.current.send(JSON.stringify({ type: 'finished', data: { size: countersRef.current.expectedTotalSize } }));
      targetDirHandleRef.current = null;
      releaseWakeLock();
    }
  };

  return (
    <PageWrapper>
      <HeaderComponent 
        icon='📁'
        title="WebRTC · Transferência P2P" 
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
          dotWs={dotWs} />
      </Card>

      {/* Seção Enviar */}
      <Card>
        <CardTitle>Enviar arquivos</CardTitle>
        <InputsSendFiles
          isConnected={isConnected}
          handleFileChange={handleFileChange}
          />
      </Card>

      {/* Seção Filas */}
      <Card>
        <CardTitle>Fila de Envio / Recebimento</CardTitle>
        <TransferComponent
          sendQueue={sendQueue}
          receiveQueue={receiveQueue}
          sendCountText={sendCountText}
          receiveCountText={receiveCountText}
          showSendConfirm={showSendConfirm}
          showAcceptConfirm={showAcceptConfirm}
          totalSendSize={totalSendSize}
          totalReceiveSize={totalReceiveSize}
          acceptDisabled={acceptDisabled}
          acceptBtnText={acceptBtnText}
          handleSendFiles={handleSendFiles}
          handleAcceptFiles={handleAcceptFiles}
          />
      </Card>

      {/* Log */}
      <Card>
        <CardTitle>Log</CardTitle>
        <LogComponent logs={logs} onClear={() => setLogs([])} />
      </Card>
    </PageWrapper>
  );
}