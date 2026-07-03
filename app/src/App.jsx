import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';
import { router } from './routes';

function App() {
  return (
    <ThemeProvider theme={theme}>
      {/* CssBaseline aplica um reset CSS consistente baseado no Material Design */}
      <CssBaseline />
      <Suspense fallback={<div>Loading...</div>}>
        <RouterProvider router={router} />
      </Suspense>
    </ThemeProvider>
  );
}

export default App;