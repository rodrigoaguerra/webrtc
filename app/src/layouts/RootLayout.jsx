import { Outlet, useNavigate } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Button, Container, Box } from '@mui/material';

export default function RootLayout() {
  const navigate = useNavigate();

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate('/')}>
            Meu App
          </Typography>
          <Button color="inherit" onClick={() => navigate('/')}>Home</Button>
          <Button color="inherit" onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </Toolbar>
      </AppBar>
      
      <Container sx={{ mt: 4 }}>
        {/* O Outlet renderiza a página da rota atual */}
        <Outlet />
      </Container>
    </Box>
  );
}