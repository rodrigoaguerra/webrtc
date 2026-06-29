import { Link } from 'react-router-dom';
import { Box, Typography, styled } from '@mui/material';

const HeaderWrapper = styled(Box)(() => ({  
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  '& .logo': {
    width: '44px', 
    height: '44px',
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    borderRadius: '12px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '1.4rem'
  },
  '& h1': {
    fontSize: '1.3rem',
    fontWeight: 600,
    letterSpacing: '-.02em'
  },
  '& p': {
    fontSize: '.8rem',
    color: 'var(--muted)'
  }
}));

export default function HeaderComponent({ title, description }) {
  return (
    <HeaderWrapper>
      <div className="logo">📁</div>
      <div>
        <Typography variant="h1">{title}</Typography>
        <p>{description}</p>
      </div>
    </HeaderWrapper>
  );
}