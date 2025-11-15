import express from 'express';

const router = express.Router();

// Get all groups for a session
router.get('/:session_id/groups', async (req, res) => {
  const { session_id } = req.params;
  const { sessionManager } = req.app.locals;

  try {
    const groups = await sessionManager.getGroups(session_id);
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new group
router.post('/:session_id/create', async (req, res) => {
  const { session_id } = req.params;
  const { group_name, participants } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    const group = await sessionManager.createGroup(session_id, group_name, participants);
    res.json({ success: true, group_id: group.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add participants
router.post('/:group_jid/add-participants', async (req, res) => {
  const { group_jid } = req.params;
  const { session_id, participants } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    await sessionManager.addGroupParticipants(session_id, group_jid, participants);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote to admin
router.post('/:group_jid/promote', async (req, res) => {
  const { group_jid } = req.params;
  const { session_id, participants } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    await sessionManager.promoteToAdmin(session_id, group_jid, participants);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
