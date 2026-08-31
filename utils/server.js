require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const rosterRoutes = require('./routes/roster');
const selfServiceRoutes = require('./routes/selfservice');
const exportRoutes = require('./routes/export');
const importRoutes = require('./routes/import');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'megaclinic-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

app.use('/api/admin', authRoutes);
app.use('/api/admin', importRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/self-service', selfServiceRoutes);
app.use('/api/export', exportRoutes);

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/self-service', (req, res) => res.sendFile(path.join(__dirname, 'public', 'self-service.html')));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Mega Clinic insurance app listening on port ${PORT}`);
});
