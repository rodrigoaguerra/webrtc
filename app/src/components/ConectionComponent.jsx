import { Link } from 'react-router-dom';
import { Box, styled } from '@mui/material';

const ConectionWrapper = styled(Box)(() => ({  
  display: 'grid',
  gridTemplateColumns: '1fr 1fr auto',
  gap: '.75rem',
  alignItems: 'end',
  '& label':  { 
    display: 'block',
    fontSize: '.78rem', 
    color: 'var(--muted);',
    marginBottom: '.35rem' 
  },
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
    transition: 'border-color .2s'
  },
  '& input::focus': { borderColor: 'var(--accent)' }
}));

const Btn = styled('button')({
  padding: '.65rem 1.4rem',
  border: 'none',
  cursor: 'pointer',
  borderRadius: '8px',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: '.85rem',
  transition: 'opacity .2s, transform .1s',
  '&:active': { transform: 'scale(.97)' },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
  '&.btn-primary': {
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    color: '#fff',
  },
  '&.btn-secondary': {
    background: 'rgba(255,255,255,.05)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  }
});

export default function ConectionComponent({ srvUrl, setSrvUrl, room, setRoom, handleConnect, dotWs }) {
  return (
    <ConectionWrapper>
      <div>
        <label>Servidor Signaling</label>
        <input value={srvUrl} onChange={e => setSrvUrl(e.target.value)} disabled={dotWs === 'green'} />
      </div>
      <div>
        <label>Sala</label>
        <input value={room} onChange={e => setRoom(e.target.value)} disabled={dotWs === 'green'} />
      </div>
      <Btn className="btn-primary" onClick={handleConnect} disabled={dotWs === 'green'}>Conectar</Btn>
    </ConectionWrapper>
  );
}