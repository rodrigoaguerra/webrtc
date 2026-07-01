import { Box, Button } from '@mui/material';

export default function ActionsComponent({
  cameraDisabled,
  callDisabled,
  hangupDisabled,
  handleStartCamera,
  handleCall,
  handleHangup,
}) {
  return (
    <Box sx={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.9rem' }}>
      <Button
        disabled={cameraDisabled}
        onClick={handleStartCamera}
        sx={{
          padding: '.65rem 1.4rem',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          fontSize: '.85rem',
          textTransform: 'none',
          backgroundColor: 'rgba(255,255,255,.08)',
          color: 'var(--text)',
          '&:hover': { backgroundColor: 'rgba(255,255,255,.12)' },
          '&:disabled': { opacity: 0.4, color: 'var(--text)' },
        }}
      >
        📷 Câmera
      </Button>

      <Button
        disabled={callDisabled}
        onClick={handleCall}
        sx={{
          padding: '.65rem 1.4rem',
          border: 'none',
          borderRadius: '8px',
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          fontSize: '.85rem',
          textTransform: 'none',
          background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
          color: '#fff',
          '&:disabled': { opacity: 0.4, color: '#fff' },
        }}
      >
        📞 Ligar
      </Button>

      <Button
        disabled={hangupDisabled}
        onClick={handleHangup}
        sx={{
          padding: '.65rem 1.4rem',
          border: 'none',
          borderRadius: '8px',
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          fontSize: '.85rem',
          textTransform: 'none',
          backgroundColor: 'var(--red)',
          color: '#fff',
          '&:disabled': { opacity: 0.4, color: '#fff' },
        }}
      >
        🔴 Desligar
      </Button>
    </Box>
  );
}
