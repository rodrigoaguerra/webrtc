import { Link } from 'react-router-dom';
import { Box, styled } from '@mui/material';

const InputsSendFilesWrapper = styled(Box)(() => ({
  '& .controls': {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: '.75rem',
    alignItems: 'end',
    '& > label':  { 
      display: 'block', 
      fontSize: '.78rem',
      color: 'var(--muted)', 
      marginBottom: '.35rem' 
    },
    '& > input': {
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
    
    '& > input::focus': { borderColor: 'var(--accent)' }
  },
}));

export default function InputsSendFiles({ isConnected, handleFileChange }) {
  return (
    <InputsSendFilesWrapper>
      <Box className="controls">
        <div>
          <label>Arquivos</label>
          <input type="file" multiple disabled={!isConnected} onChange={e => handleFileChange(e, false)} />
        </div>
        <div>
          <label>Pasta</label>
          <input type="file" webkitdirectory="true" directory="true" multiple disabled={!isConnected} onChange={e => handleFileChange(e, true)} />
        </div>
      </Box>
      <p className="hint">Segure Ctrl/Cmd para selecionar vários arquivos</p>
    </InputsSendFilesWrapper>
  );
}