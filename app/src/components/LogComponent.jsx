import { useEffect } from 'react';
import { Box, styled } from '@mui/material';

const LogWrapper = styled(Box)(() => ({
  background: '#070b14',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '1rem',
  height: '180px',
  overflowY: 'auto',
  fontFamily: 'var(--font-mono)',
  fontSize: '.75rem',
  lineHeight: 1.7,
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--border) transparent',
  
  // Customização para navegadores baseados em Webkit (Chrome, Safari, Edge)
  '&::-webkit-scrollbar': {
    width: '6px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--border)',
    borderRadius: '4px',
  },
  '& .log-line': { 
    display: 'flex',
    gap: '.6rem',
  },
  '& .log-time': { color: 'var(--muted)', flexShrink: 0 },
  '& .log-icon': { flexShrink: 0 },
  '& .log-msg': { color: 'var(--text)' },
  '& .log-msg.success': { color: 'var(--green)' },
  '& .log-msg.error': { color: 'var(--red)' },
  '& .log-msg.warn': { color: 'var(--yellow)' },
  '& .log-msg.info': { color: 'var(--accent)' },
  '& .log-msg.send': { color: 'var(--yellow)' },
  '& .log-msg.receive': { color: 'var(--green)' }
}));

export default function LogComponent({ logs, onClear }) {
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️', send: '📦', receive: '📥' };

  useEffect(() => {
    const clearLogs = () => {
      onClear();
    };
    window.addEventListener('beforeunload', clearLogs);
    return () => {
      window.removeEventListener('beforeunload', clearLogs);
    };
  }, [onClear]);

  return (
    <LogWrapper>
      {logs.map(log => (
        <div className="log-line" key={log.id}>
          <span className="log-time">{log.time}</span>
          <span className="log-icon">{icons[log.type] || '·'}</span>
          <span className={`log-msg ${log.type}`}>{log.msg}</span>
        </div>
      ))}
    </LogWrapper>
  );
}