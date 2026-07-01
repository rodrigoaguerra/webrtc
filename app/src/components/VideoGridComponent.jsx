import { Box, styled } from '@mui/material';

const VideoGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '1rem',
  '@media (max-width: 600px)': {
    gridTemplateColumns: '1fr',
  },
});

const VideoWrap = styled(Box)({
  position: 'relative',
  borderRadius: 'var(--radius)',
  overflow: 'hidden',
  backgroundColor: '#070b14',
  aspectRatio: '16/9',
  border: '1px solid var(--border)',
});

const StyledVideo = styled('video')({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
});

const VideoLabel = styled(Box)({
  position: 'absolute',
  bottom: '.6rem',
  left: '.75rem',
  fontSize: '.7rem',
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  color: 'rgba(255,255,255,.7)',
  backgroundColor: 'rgba(0,0,0,.5)',
  padding: '.2rem .5rem',
  borderRadius: '4px',
  backdropFilter: 'blur(6px)',
});

const VideoPlaceholder = styled(Box)({
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  color: 'var(--muted)',
  fontSize: '2rem',
});

export default function VideoGridComponent({ localVideoRef, remoteVideoRef, showLocalPh, showRemotePh }) {
  return (
    <VideoGrid>
      <VideoWrap>
        {showLocalPh && <VideoPlaceholder>🎥</VideoPlaceholder>}
        <StyledVideo ref={localVideoRef} autoPlay muted playsInline />
        <VideoLabel>Você</VideoLabel>
      </VideoWrap>

      <VideoWrap>
        {showRemotePh && <VideoPlaceholder>👤</VideoPlaceholder>}
        <StyledVideo ref={remoteVideoRef} autoPlay playsInline />
        <VideoLabel>Remoto</VideoLabel>
      </VideoWrap>
    </VideoGrid>
  );
}
