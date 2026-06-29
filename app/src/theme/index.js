import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00d4ff', // var(--accent)
    },
    secondary: {
      main: '#0066ff', // var(--accent2)
    },
    background: {
      default: '#080c12',
      paper: '#0d1420',
    },
    text: {
      primary: '#c8d8e8',
      secondary: '#4a6080',
    },
  },
  typography: {
    fontFamily: '"Outfit", "Roboto", sans-serif',
  },
});

export default theme;