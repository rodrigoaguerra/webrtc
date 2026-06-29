import { Typography, Paper, Grid } from '@mui/material';

export default function Dashboard() {
  return (
    <div>
      <Typography variant="h4" gutterBottom>Dashboard</Typography>
      <Grid container spacing={3}>
        {[1, 2, 3].map((item) => (
          <Grid item xs={12} sm={4} key={item}>
            <Paper sx={{ p: 3, textAlign: 'center' }} elevation={3}>
              <Typography variant="h6">Card {item}</Typography>
              <Typography variant="body2" color="text.secondary">Dados e métricas aqui.</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </div>
  );
}