import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionDir = process.env.SESSION_STORAGE_PATH || './auth_sessions';

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  async createSession(sessionId, callbacks = {}) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const authPath = path.join(this.sessionDir, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: logger.child({ sessionId }),
      browser: ['GoGHL Platform', 'Chrome', '1.0.0'],
      defaultQueryTimeoutMs: undefined
    });

    // Store session info
    this.sessions.set(sessionId, {
      sock,
      sessionId,
      status: 'connecting',
      phoneNumber: null,
      createdAt: new Date()
    });

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && callbacks.onQR) {
        callbacks.onQR(qr);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        logger.info(`Session ${sessionId} closed. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => this.createSession(sessionId, callbacks), 3000);
        } else {
          this.sessions.delete(sessionId);
          if (callbacks.onDisconnect) callbacks.onDisconnect();
        }
      }

      if (connection === 'open') {
        const session = this.sessions.get(sessionId);
        session.status = 'connected';
        session.phoneNumber = sock.user.id.split(':')[0];

        logger.info(`✅ Session ${sessionId} connected: ${session.phoneNumber}`);

        if (callbacks.onConnected) {
          callbacks.onConnected({
            phoneNumber: session.phoneNumber,
            user: sock.user
          });
        }
      }
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify' && callbacks.onMessage) {
        for (const msg of messages) {
          callbacks.onMessage(msg);
        }
      }
    });

    // Handle group updates
    sock.ev.on('groups.update', async (updates) => {
      if (callbacks.onGroupUpdate) {
        callbacks.onGroupUpdate(updates);
      }
    });

    return sock;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async destroySession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await session.sock.logout();
    } catch (err) {
      logger.error(`Error logging out session ${sessionId}:`, err);
    }

    this.sessions.delete(sessionId);

    // Clean up auth files
    const authPath = path.join(this.sessionDir, sessionId);
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      sessionId: id,
      status: session.status,
      phoneNumber: session.phoneNumber,
      createdAt: session.createdAt
    }));
  }

  async sendMessage(sessionId, jid, message) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    return await session.sock.sendMessage(jid, { text: message });
  }

  async createGroup(sessionId, groupName, participants) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    // Format participants with @s.whatsapp.net
    const formattedParticipants = participants.map(p =>
      p.includes('@') ? p : `${p}@s.whatsapp.net`
    );

    const group = await session.sock.groupCreate(groupName, formattedParticipants);
    return group;
  }

  async getGroups(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    const groups = await session.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participantCount: g.participants.length,
      creation: g.creation,
      owner: g.owner
    }));
  }

  async addGroupParticipants(sessionId, groupJid, participants) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    const formatted = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await session.sock.groupParticipantsUpdate(groupJid, formatted, 'add');
  }

  async promoteToAdmin(sessionId, groupJid, participants) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    const formatted = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await session.sock.groupParticipantsUpdate(groupJid, formatted, 'promote');
  }
}

export default SessionManager;
