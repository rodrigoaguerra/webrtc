import { Link } from 'react-router-dom';
import { Box, Typography, styled } from '@mui/material';

// Estilizando o Card para se comportar exatamente como o seu CSS original
const StyledCard = styled(Link)(() => ({
  position: 'relative',
  display: 'block',
  textDecoration: 'none',
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '32px 36px',
  overflow: 'hidden',
  transition: 'border-color 0.3s, transform 0.3s, box-shadow 0.3s',
  animation: 'fadeUp 0.6s ease both',
  
  '&:nth-of-type(1)': { animationDelay: '0.25s' },
  '&:nth-of-type(2)': { animationDelay: '0.40s' },
  '&:nth-of-type(3)': { animationDelay: '0.55s' },

  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    background: 'var(--card-glow)',
    opacity: 0,
    transition: 'opacity 0.3s',
  },

  '&::after': {
    content: '""',
    position: 'absolute',
    left: 0,
    top: '20%',
    bottom: '20%',
    width: '2px',
    background: 'linear-gradient(180deg, var(--accent), var(--accent2))',
    borderRadius: '0 2px 2px 0',
    opacity: 0,
    transition: 'opacity 0.3s, top 0.3s, bottom 0.3s',
  },

  '&:hover': {
    borderColor: 'rgba(0, 212, 255, 0.35)',
    transform: 'translateY(-3px)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,212,255,0.08)',
    
    '&::before': { opacity: 1 },
    '&::after': { opacity: 1, top: '10%', bottom: '10%' },
    '& .icon-box': {
      backgroundColor: 'rgba(0,212,255,0.1)',
      borderColor: 'rgba(0,212,255,0.35)',
    },
    '& .card-arrow': {
      opacity: 1,
      transform: 'translateY(-50%) translateX(0)',
    }
  },
}));

export default function Home() {
  return (
    <Box className="wrapper" sx={{ position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '60px 24px 80px' }}>
      
      {/* ── Header ── */}
      <Box component="header" sx={{ marginBottom: '64px', animation: 'fadeDown 0.7s ease both' }}>
        <Box 
          className="badge" 
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.15em',
            color: 'var(--accent)',
            background: 'rgba(0,212,255,0.07)',
            border: '1px solid rgba(0,212,255,0.2)',
            padding: '5px 12px',
            borderRadius: '2px',
            marginBottom: '24px',
            textTransform: 'uppercase',
            '&::before': {
              content: '""',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--green)',
              boxShadow: '0 0 8px var(--green)',
              animation: 'pulse 2s infinite',
            }
          }}
        >
          WebRTC Hub — Socket.io
        </Box>
        
        <Typography variant="h1" sx={{ fontSize: 'clamp(2.2rem, 5vw, 3.4rem)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#fff' }}>
          Módulos <Box component="span" sx={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>em tempo real</Box>
        </Typography>
        
        <Typography className="subtitle" sx={{ marginTop: '14px', fontSize: '1rem', color: 'var(--muted)', fontWeight: 300, maxWidth: 480, lineHeight: 1.6 }}>
          Aplicações peer-to-peer construídas com WebRTC e Socket.io. Selecione um módulo para acessá-lo.
        </Typography>
      </Box>

      {/* ── Divider ── */}
      <Box className="divider" sx={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '40px', animation: 'fadeUp 0.6s 0.2s ease both' }}>
        <Typography component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          Aplicações disponíveis
        </Typography>
        <Box component="span" sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--border), transparent)' }} />
      </Box>

      {/* ── Cards Grid ── */}
      <Box sx={{ display: 'grid', gap: '20px' }}>
        
        {/* Card: Video */}
        <StyledCard to="/video">
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '24px' }}>
            <Box className="icon-box" sx={{ flexShrink: 0, width: 52, height: 52, display: 'flex', alignItems: 'center', justifyindex: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '3px', transition: 'background 0.3s, border-color 0.3s' }}>
              <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, stroke: 'var(--accent)', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
              </svg>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <Typography component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', opacity: 0.7 }}>
                  routes/video
                </Typography>
                <Box component="span" sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--green)', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.18)', padding: '2px 7px', borderRadius: '2px' }}>
                  Live
                </Box>
              </Box>
              <Typography variant="h2" sx={{ fontSize: '1.25rem', fontWeight: 600, color: '#fff', marginBottom: '8px', letterSpacing: '-0.01em' }}>
                Videochamada
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.65, fontWeight: 300 }}>
                Comunicação de vídeo e áudio em tempo real entre peers via WebRTC. Suporte a múltiplos participantes com sinalização gerenciada pelo Socket.io.
              </Typography>
            </Box>
            <Box className="card-arrow" sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%) translateX(-6px)', opacity: 0, transition: 'opacity 0.3s, transform 0.3s', color: 'var(--accent)' }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Box>
          </Box>
        </StyledCard>

        {/* Card: Transfer */}
        <StyledCard to="/transfer">
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '24px' }}>
            <Box className="icon-box" sx={{ flexShrink: 0, width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '3px', transition: 'background 0.3s, border-color 0.3s' }}>
              <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, stroke: 'var(--accent)', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4 4-4-4M12 16V4"/>
              </svg>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <Typography component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', opacity: 0.7 }}>
                  routes/transfer
                </Typography>
                <Box component="span" sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--green)', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.18)', padding: '2px 7px', borderRadius: '2px' }}>
                  P2P
                </Box>
              </Box>
              <Typography variant="h2" sx={{ fontSize: '1.25rem', fontWeight: 600, color: '#fff', marginBottom: '8px', letterSpacing: '-0.01em' }}>
                Transferência de Arquivos
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.65, fontWeight: 300 }}>
                Envio direto de arquivos entre navegadores sem passar pelo servidor, utilizando RTCDataChannel para transferência rápida e segura peer-to-peer.
              </Typography>
            </Box>
            <Box className="card-arrow" sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%) translateX(-6px)', opacity: 0, transition: 'opacity 0.3s, transform 0.3s', color: 'var(--accent)' }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Box>
          </Box>
        </StyledCard>

        {/* Card: Chat */}
        <StyledCard to="/chat">
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '24px' }}>
            <Box className="icon-box" sx={{ flexShrink: 0, width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '3px', transition: 'background 0.3s, border-color 0.3s' }}>
              <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, stroke: 'var(--accent)', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d="M8 12h.01M12 8h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.78 15.084 3 12.769 3 10c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <Typography component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', opacity: 0.7 }}>
                  routes/chat
                </Typography>
                <Box component="span" sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--green)', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.18)', padding: '2px 7px', borderRadius: '2px' }}>
                  Chat
                </Box>
              </Box>
              <Typography variant="h2" sx={{ fontSize: '1.25rem', fontWeight: 600, color: '#fff', marginBottom: '8px', letterSpacing: '-0.01em' }}>
                Chat de Texto em Grupo
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.65, fontWeight: 300 }}>
                Comunicação de texto em tempo real entre peers via WebRTC. Suporte a múltiplos participantes com sinalização gerenciada pelo Socket.io.
              </Typography>
            </Box>
            <Box className="card-arrow" sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%) translateX(-6px)', opacity: 0, transition: 'opacity 0.3s, transform 0.3s', color: 'var(--accent)' }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Box>
          </Box>
        </StyledCard>

      </Box>

      {/* ── Footer ── */}
      <Box component="footer" sx={{ marginTop: '72px', paddingTop: '24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', animation: 'fadeUp 0.6s 0.6s ease both' }}>
        <Typography component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>
          // stack
        </Typography>
        <Box className="footer-stack" sx={{ display: 'flex', gap: '10px' }}>
          {['WebRTC', 'Socket.io', 'Node.js'].map((tech) => (
            <Box key={tech} component="span" sx={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', padding: '3px 10px', borderRadius: '2px', letterSpacing: '0.06em' }}>
              {tech}
            </Box>
          ))}
        </Box>
      </Box>

    </Box>
  );
}