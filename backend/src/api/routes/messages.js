import express from 'express';

const router = express.Router();

// Send message
router.post('/:session_id/send', async (req, res) => {
  const { session_id } = req.params;
  const { to, message } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await sessionManager.sendMessage(session_id, jid, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
