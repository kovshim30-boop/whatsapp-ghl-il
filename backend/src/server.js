import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';

import SessionManager from './whatsapp/SessionManager.js';
import { generateQRDataURL } from './whatsapp/QRGenerator.js';
import pool from './config/database.js';

// Routes (we'll create these next)
import sessionsRouter from './api/routes/sessions.js';
import groupsRouter from './api/routes/groups.js';
import messagesRouter from './api/routes/messages.js';
import healthRouter from './api/routes/health.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const sessionManager = new SessionManager();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Make sessionManager and io available to routes
app.locals.sessionManager = sessionManager;
app.locals.io = io;

// Routes
app.use('/api/health', healthRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/messages', messagesRouter);

// Socket.IO
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    logger.info(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📡 WebSocket server ready`);

  // טעינת כל ה-sessions הפעילים מה-DB (session persistence!)
  try {
    await sessionManager.restoreAllSessions();
    logger.info(`✅ Session restoration completed`);
  } catch (error) {
    logger.error(`❌ Failed to restore sessions:`, error);
  }
});

export { io, sessionManager };
