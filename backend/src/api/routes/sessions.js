import express from 'express';
import { generateQRDataURL } from '../../whatsapp/QRGenerator.js';

const router = express.Router();

// Create new session
router.post('/create', async (req, res) => {
  const { session_id, user_id, sub_account_id } = req.body;
  const { sessionManager, io } = req.app.locals;

  try {
    await sessionManager.createSession(session_id, {
      onQR: async (qr) => {
        const qrDataURL = await generateQRDataURL(qr);
        io.to(session_id).emit('qr_updated', { qr: qrDataURL });
      },
      onConnected: (data) => {
        io.to(session_id).emit('connection_status', {
          status: 'connected',
          phoneNumber: data.phoneNumber
        });
      },
      onDisconnect: () => {
        io.to(session_id).emit('connection_status', { status: 'disconnected' });
      },
      onMessage: async (msg) => {
        // TODO: Save to database and sync to GHL
        io.to(session_id).emit('new_message', {
          from: msg.key.remoteJid,
          message: msg.message?.conversation || '',
          timestamp: new Date(msg.messageTimestamp * 1000)
        });
      }
    });

    res.json({ success: true, session_id, message: 'Session created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session status
router.get('/:session_id/status', (req, res) => {
  const { session_id } = req.params;
  const { sessionManager } = req.app.locals;

  const session = sessionManager.getSession(session_id);

  if (!session) {
    return res.json({ status: 'not_found' });
  }

  res.json({
    status: session.status,
    phoneNumber: session.phoneNumber,
    createdAt: session.createdAt
  });
});

// List all sessions
router.get('/', (req, res) => {
  const { sessionManager } = req.app.locals;
  const sessions = sessionManager.getAllSessions();
  res.json({ sessions });
});

// Disconnect session
router.post('/:session_id/disconnect', async (req, res) => {
  const { session_id } = req.params;
  const { sessionManager } = req.app.locals;

  try {
    await sessionManager.destroySession(session_id);
    res.json({ success: true, message: 'Session disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
