import { makeWASocket, DisconnectReason, useMultiFileAuthState, BufferJSON } from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import SessionPersistence from './SessionPersistence.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionDir = process.env.SESSION_STORAGE_PATH || './auth_sessions';
    this.persistence = new SessionPersistence();

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * טעינת כל ה-sessions הפעילים בזמן הפעלת השרת
   * פותר את הבעיה של sessions שנעלמים אחרי restart
   */
  async restoreAllSessions() {
    logger.info('🔄 Restoring active sessions from database...');

    const activeSessions = await this.persistence.getActiveSessions();

    for (const sessionData of activeSessions) {
      try {
        logger.info(`🔄 Restoring session: ${sessionData.session_id} (${sessionData.phone_number || 'unknown'})`);
        await this.createSession(sessionData.session_id, {}, sessionData.auth_state);
      } catch (error) {
        logger.error(`❌ Failed to restore session ${sessionData.session_id}:`, error);
        await this.persistence.updateSessionStatus(sessionData.session_id, 'error', null, error.message);
      }
    }

    logger.info(`✅ Restored ${activeSessions.length} sessions`);
  }

  async createSession(sessionId, callbacks = {}, existingAuthState = null) {
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

      if (qr) {
        // שמור QR ב-DB ושלח ל-callback
        await this.persistence.saveQRCode(sessionId, qr);
        if (callbacks.onQR) {
          callbacks.onQR(qr);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        logger.info(`Session ${sessionId} closed. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          await this.persistence.updateSessionStatus(sessionId, 'disconnected', null, lastDisconnect?.error?.message);
          setTimeout(() => this.createSession(sessionId, callbacks), 3000);
        } else {
          // Logged out - מחק session
          await this.persistence.updateSessionStatus(sessionId, 'disconnected', null, 'Logged out');
          this.sessions.delete(sessionId);
          if (callbacks.onDisconnect) callbacks.onDisconnect();
        }
      }

      if (connection === 'open') {
        const session = this.sessions.get(sessionId);
        session.status = 'connected';
        session.phoneNumber = sock.user.id.split(':')[0];

        logger.info(`✅ Session ${sessionId} connected: ${session.phoneNumber}`);

        // עדכן סטטוס ב-DB
        await this.persistence.updateSessionStatus(sessionId, 'connected', session.phoneNumber);
        await this.persistence.resetReconnectAttempts(sessionId);

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
      if (type === 'notify') {
        for (const msg of messages) {
          // קבל organization_id מה-session
          const sessionData = await this.persistence.loadAuthState(sessionId);

          if (callbacks.onMessage) {
            callbacks.onMessage(msg);
          }

          // שמור הודעה ב-DB (יטופל על ידי המערכת המרכזית)
          logger.debug(`📨 Received message: ${msg.key.id}`);
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

  async getGroupMetadata(sessionId, groupJid) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    return await session.sock.groupMetadata(groupJid);
  }

  async removeGroupParticipants(sessionId, groupJid, participants) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    const formatted = participants.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
    return await session.sock.groupParticipantsUpdate(groupJid, formatted, 'remove');
  }

  async leaveGroup(sessionId, groupJid) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Session ${sessionId} not connected`);
    }

    return await session.sock.groupLeave(groupJid);
  }
}

export default SessionManager;
