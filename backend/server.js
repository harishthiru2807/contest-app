const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 1. MUST BE FIRST: Load Env and Validate
require('dotenv').config();

const requiredEnv = ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missingEnv = requiredEnv.filter(k => !process.env[k] || process.env[k].trim() === '');

if (missingEnv.length > 0) {
  console.error('\n❌ CRITICAL ERROR: Missing or empty environment variables:', missingEnv.join(', '));
  console.error('Check your Render/Railway dashboard or .env file.');
  // In production, we must stop if secrets are missing to prevent auth bypass/errors
  if (process.env.NODE_ENV === 'production') {
    console.error('Stopping server to prevent runtime errors.');
    process.exit(1);
  }
}

// 2. Initialize Database (NeDB)
require('./src/db');

const authRoutes = require('./src/routes/auth');
const contestRoutes = require('./src/routes/contest');
const adminRoutes = require('./src/routes/admin');
const codeRoutes = require('./src/routes/code');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000']
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.set('io', io);

const activeConnections = new Map();
app.set('activeConnections', activeConnections);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/contest', contestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/code', codeRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), db: 'SQLite' });
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('register', ({ teamID }) => {
    if (teamID) {
      socket.join(`team_${teamID}`);
      activeConnections.set(teamID, socket.id);
      console.log(`Team ${teamID} registered`);
    }
  });

  socket.on('disconnect', () => {
    for (const [teamID, socketId] of activeConnections.entries()) {
      if (socketId === socket.id) { activeConnections.delete(teamID); break; }
    }
    console.log('Socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

// Serve frontend in production (Railway / any host)
const frontendDist = path.join(__dirname, '../frontend/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    }
  });
  console.log('🌐 Serving frontend from:', frontendDist);
}

server.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log('📁 Database: SQLite (no MongoDB needed)');
});

module.exports = { io };
