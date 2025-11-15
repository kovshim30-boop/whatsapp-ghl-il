# 🚀 תכנית מפורטת: WhatsApp-GHL SaaS Platform

## 🎯 היעד: נצח את GoGHL תוך 60 יום

---

## 📋 15 צעדים טכניים ליישום

### **שלב 1: Database Schema + RLS (Supabase)**

#### סכמת הטבלאות:

```sql
-- ========================================
-- 1. USERS TABLE (Supabase Auth מנהל אוטומטית)
-- ========================================

-- ========================================
-- 2. ORGANIZATIONS TABLE (Multi-tenancy)
-- ========================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'starter', 'pro', 'enterprise')),
  max_accounts INTEGER DEFAULT 1,
  max_messages_per_month INTEGER DEFAULT 1000,
  webhook_url TEXT,
  ghl_api_key TEXT,
  ghl_location_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 3. WHATSAPP_SESSIONS TABLE
-- ========================================
CREATE TABLE whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number TEXT,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
  qr_code TEXT,
  auth_state JSONB, -- Baileys auth state
  last_seen_at TIMESTAMPTZ,
  error_message TEXT,
  reconnect_attempts INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_org ON whatsapp_sessions(organization_id);
CREATE INDEX idx_sessions_status ON whatsapp_sessions(status);

-- ========================================
-- 4. MESSAGES TABLE
-- ========================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  content JSONB NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  is_group_message BOOLEAN DEFAULT FALSE,
  group_jid TEXT,
  synced_to_ghl BOOLEAN DEFAULT FALSE,
  ghl_message_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_org ON messages(organization_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX idx_messages_ghl_sync ON messages(synced_to_ghl) WHERE synced_to_ghl = FALSE;

-- ========================================
-- 5. GROUPS TABLE
-- ========================================
CREATE TABLE whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  participant_count INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, group_jid)
);

CREATE INDEX idx_groups_session ON whatsapp_groups(session_id);

-- ========================================
-- 6. GROUP_PARTICIPANTS TABLE
-- ========================================
CREATE TABLE group_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, phone_number)
);

-- ========================================
-- 7. USAGE_TRACKING TABLE (למודל תמחור)
-- ========================================
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  active_sessions INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, period_start)
);

-- ========================================
-- 8. WEBHOOK_LOGS TABLE (reliability tracking)
-- ========================================
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  webhook_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_status ON webhook_logs(status) WHERE status IN ('pending', 'failed');

-- ========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Organizations: Users can only see their own orgs
CREATE POLICY "Users can view their own organizations"
  ON organizations FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can update their own organizations"
  ON organizations FOR UPDATE
  USING (auth.uid() = owner_id);

-- Sessions: Scoped to organization
CREATE POLICY "Users can view their org sessions"
  ON whatsapp_sessions FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their org sessions"
  ON whatsapp_sessions FOR ALL
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- Messages: Scoped to organization
CREATE POLICY "Users can view their org messages"
  ON messages FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- Functions for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### הרץ ב-Supabase SQL Editor:
1. לך ל-Supabase Dashboard → SQL Editor
2. העתק והרץ את הסכמה למעלה
3. וודא שה-RLS policies פעילות

---

### **שלב 2: Session Persistence - שמירת Sessions ב-Supabase**

הבעיה הנוכחית: sessions נשמרים רק בזיכרון ונעלמים אחרי restart.

**הפתרון:** שמור את `auth_state` של Baileys ב-Supabase והטען אותו בזמן הפעלה.

#### קובץ: `backend/src/whatsapp/SessionPersistence.js`

```javascript
import pool from '../config/database.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

class SessionPersistence {
  /**
   * שמירת auth state ל-DB
   */
  async saveAuthState(sessionId, authState) {
    try {
      await pool.query(
        `UPDATE whatsapp_sessions
         SET auth_state = $1, updated_at = NOW()
         WHERE session_id = $2`,
        [JSON.stringify(authState), sessionId]
      );
      logger.info(`✅ Saved auth state for session: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ Failed to save auth state for ${sessionId}:`, error);
    }
  }

  /**
   * טעינת auth state מה-DB
   */
  async loadAuthState(sessionId) {
    try {
      const result = await pool.query(
        `SELECT auth_state FROM whatsapp_sessions WHERE session_id = $1`,
        [sessionId]
      );

      if (result.rows.length > 0 && result.rows[0].auth_state) {
        logger.info(`✅ Loaded auth state for session: ${sessionId}`);
        return result.rows[0].auth_state;
      }

      return null;
    } catch (error) {
      logger.error(`❌ Failed to load auth state for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * עדכון סטטוס session
   */
  async updateSessionStatus(sessionId, status, phoneNumber = null, errorMessage = null) {
    try {
      await pool.query(
        `UPDATE whatsapp_sessions
         SET status = $1,
             phone_number = COALESCE($2, phone_number),
             error_message = $3,
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE session_id = $4`,
        [status, phoneNumber, errorMessage, sessionId]
      );
      logger.info(`✅ Updated session ${sessionId} status to: ${status}`);
    } catch (error) {
      logger.error(`❌ Failed to update session status:`, error);
    }
  }

  /**
   * שמירת QR code ל-DB
   */
  async saveQRCode(sessionId, qrCode) {
    try {
      await pool.query(
        `UPDATE whatsapp_sessions
         SET qr_code = $1, updated_at = NOW()
         WHERE session_id = $2`,
        [qrCode, sessionId]
      );
    } catch (error) {
      logger.error(`❌ Failed to save QR code:`, error);
    }
  }

  /**
   * קבלת כל ה-sessions הפעילים (לטעינה בזמן הפעלה)
   */
  async getActiveSessions() {
    try {
      const result = await pool.query(
        `SELECT session_id, organization_id, auth_state
         FROM whatsapp_sessions
         WHERE status IN ('connected', 'connecting')
         AND auth_state IS NOT NULL`
      );
      return result.rows;
    } catch (error) {
      logger.error(`❌ Failed to get active sessions:`, error);
      return [];
    }
  }
}

export default SessionPersistence;
```

#### עדכון SessionManager לתמיכה ב-Persistence:

```javascript
// backend/src/whatsapp/SessionManager.js
import { makeWASocket, useMultiFileAuthState, DisconnectReason, BufferJSON } from '@whiskeysockets/baileys';
import SessionPersistence from './SessionPersistence.js';

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.persistence = new SessionPersistence();
  }

  /**
   * טעינת כל ה-sessions הפעילים בזמן הפעלה
   */
  async restoreAllSessions() {
    const activeSessions = await this.persistence.getActiveSessions();

    for (const sessionData of activeSessions) {
      try {
        await this.createSession(sessionData.session_id, {}, sessionData.auth_state);
      } catch (error) {
        console.error(`Failed to restore session ${sessionData.session_id}:`, error);
      }
    }
  }

  async createSession(sessionId, callbacks = {}, existingAuthState = null) {
    // ... (הקוד הקיים)

    // במקום useMultiFileAuthState, השתמש ב-DB state:
    const authState = existingAuthState || await this.persistence.loadAuthState(sessionId);

    const sock = makeWASocket({
      auth: authState ? JSON.parse(authState, BufferJSON.reviver) : undefined,
      // ... rest of config
    });

    // שמור auth state אחרי כל עדכון
    sock.ev.on('creds.update', async () => {
      const state = JSON.stringify(sock.authState.creds, BufferJSON.replacer);
      await this.persistence.saveAuthState(sessionId, state);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr } = update;

      if (qr) {
        await this.persistence.saveQRCode(sessionId, qr);
      }

      if (connection === 'open') {
        await this.persistence.updateSessionStatus(sessionId, 'connected', sock.user.id.split(':')[0]);
      } else if (connection === 'close') {
        await this.persistence.updateSessionStatus(sessionId, 'disconnected');
      }
    });

    return sock;
  }
}
```

---

### **שלב 3: Authentication Flow עם Supabase Auth**

```javascript
// backend/src/middleware/auth.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // קבל את ה-organization של המשתמש
    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    req.user = user;
    req.organization = org;

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
```

#### הוסף למסלולים:

```javascript
// backend/src/api/routes/sessions.js
import { authenticateUser } from '../../middleware/auth.js';

router.post('/create', authenticateUser, async (req, res) => {
  const { organization } = req;

  // בדוק אם המשתמש לא עבר את מגבלת החשבונות
  const sessionsCount = await getSessionCountForOrg(organization.id);
  if (sessionsCount >= organization.max_accounts) {
    return res.status(403).json({
      error: 'Account limit reached. Please upgrade your plan.'
    });
  }

  // המשך...
});
```

---

### **שלב 4: Multi-tenant Session Management**

```javascript
// backend/src/services/MultiTenantSessionService.js
class MultiTenantSessionService {
  constructor(sessionManager, persistence) {
    this.sessionManager = sessionManager;
    this.persistence = persistence;
  }

  async createSessionForOrganization(organizationId, userId) {
    const sessionId = `${organizationId}_${Date.now()}`;

    // צור רשומה ב-DB
    await pool.query(
      `INSERT INTO whatsapp_sessions (session_id, organization_id, status)
       VALUES ($1, $2, 'connecting')`,
      [sessionId, organizationId]
    );

    // צור session בפועל
    await this.sessionManager.createSession(sessionId, {
      onConnected: async (data) => {
        await this.persistence.updateSessionStatus(sessionId, 'connected', data.phoneNumber);
        await this.trackUsage(organizationId, 'session_created');
      },
      onMessage: async (msg) => {
        await this.handleIncomingMessage(organizationId, sessionId, msg);
      }
    });

    return sessionId;
  }

  async handleIncomingMessage(organizationId, sessionId, message) {
    // 1. שמור הודעה ב-DB
    const messageData = await this.saveMessage(organizationId, sessionId, message);

    // 2. שלח ל-GHL webhook
    await this.sendToGHL(organizationId, messageData);

    // 3. עדכן usage tracking
    await this.trackUsage(organizationId, 'message_received');
  }

  async trackUsage(organizationId, eventType) {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    await pool.query(
      `INSERT INTO usage_tracking (organization_id, period_start, messages_received)
       VALUES ($1, $2::date, 1)
       ON CONFLICT (organization_id, period_start)
       DO UPDATE SET messages_received = usage_tracking.messages_received + 1`,
      [organizationId, `${period}-01`]
    );
  }
}
```

---

### **שלב 5: GHL Webhook Integration מלאה**

```javascript
// backend/src/services/GHLWebhookService.js
import axios from 'axios';
import pool from '../config/database.js';

class GHLWebhookService {
  async sendMessageToGHL(organizationId, messageData) {
    // קבל GHL config
    const org = await this.getOrgConfig(organizationId);

    if (!org.webhook_url) {
      console.warn('No webhook URL configured for org:', organizationId);
      return;
    }

    const payload = {
      type: 'whatsapp_message',
      data: {
        from: messageData.from_number,
        to: messageData.to_number,
        message: messageData.content,
        timestamp: messageData.timestamp,
        messageId: messageData.message_id
      }
    };

    try {
      const response = await axios.post(org.webhook_url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${org.ghl_api_key}`
        },
        timeout: 10000
      });

      // שמור log
      await this.logWebhook(organizationId, messageData.id, 'success', response.status);

      // עדכן שההודעה סונכרנה
      await pool.query(
        `UPDATE messages SET synced_to_ghl = true, ghl_message_id = $1 WHERE id = $2`,
        [response.data?.messageId, messageData.id]
      );

    } catch (error) {
      await this.logWebhook(organizationId, messageData.id, 'failed', error.response?.status);

      // Retry logic
      await this.scheduleRetry(organizationId, messageData);
    }
  }

  async scheduleRetry(organizationId, messageData, retryCount = 0) {
    if (retryCount >= 3) {
      console.error('Max retries reached for message:', messageData.id);
      return;
    }

    const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    setTimeout(async () => {
      await this.sendMessageToGHL(organizationId, messageData);
    }, delay);
  }
}
```

---

### **שלב 6: Advanced Group Management Features**

```javascript
// backend/src/api/routes/groups.js - תכונות מתקדמות

// שליחת הודעה לכל חברי קבוצה
router.post('/:group_jid/broadcast', authenticateUser, async (req, res) => {
  const { group_jid } = req.params;
  const { session_id, message } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    const group = await sessionManager.getGroupMetadata(session_id, group_jid);

    // שלח לכל משתתף בנפרד (broadcast)
    const participants = group.participants.map(p => p.id);

    for (const jid of participants) {
      await sessionManager.sendMessage(session_id, jid, message);
    }

    res.json({ success: true, sent_to: participants.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// קבלת פרטי משתתפים
router.get('/:group_jid/participants', authenticateUser, async (req, res) => {
  const { group_jid } = req.params;
  const { session_id } = req.query;
  const { sessionManager } = req.app.locals;

  try {
    const metadata = await sessionManager.getGroupMetadata(session_id, group_jid);

    const participants = metadata.participants.map(p => ({
      id: p.id,
      isAdmin: p.admin !== null,
      isSuperAdmin: p.admin === 'superadmin'
    }));

    res.json({ participants });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// הסרת משתתף
router.post('/:group_jid/remove-participant', authenticateUser, async (req, res) => {
  const { group_jid } = req.params;
  const { session_id, participant } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    const session = sessionManager.getSession(session_id);
    const formatted = participant.includes('@') ? participant : `${participant}@s.whatsapp.net`;

    await session.sock.groupParticipantsUpdate(group_jid, [formatted], 'remove');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// עדכון הגדרות קבוצה
router.post('/:group_jid/settings', authenticateUser, async (req, res) => {
  const { group_jid } = req.params;
  const { session_id, setting, value } = req.body;
  const { sessionManager } = req.app.locals;

  try {
    const session = sessionManager.getSession(session_id);

    // הגדרות זמינות: 'announcement' (רק אדמינים שולחים), 'not_announcement', 'locked', 'unlocked'
    await session.sock.groupSettingUpdate(group_jid, setting);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

### **שלב 7: Error Handling + Auto-Reconnection**

```javascript
// backend/src/whatsapp/ReconnectionManager.js
class ReconnectionManager {
  constructor(sessionManager, persistence) {
    this.sessionManager = sessionManager;
    this.persistence = persistence;
    this.reconnectionAttempts = new Map();
    this.maxAttempts = 5;
  }

  async handleDisconnection(sessionId, reason) {
    const attempts = this.reconnectionAttempts.get(sessionId) || 0;

    if (attempts >= this.maxAttempts) {
      console.error(`Max reconnection attempts reached for ${sessionId}`);
      await this.persistence.updateSessionStatus(sessionId, 'error', null, 'Max reconnection attempts exceeded');
      return;
    }

    this.reconnectionAttempts.set(sessionId, attempts + 1);

    const delay = Math.min(1000 * Math.pow(2, attempts), 30000); // Max 30s

    console.log(`Reconnecting session ${sessionId} in ${delay}ms (attempt ${attempts + 1})`);

    setTimeout(async () => {
      try {
        await this.sessionManager.createSession(sessionId);
        this.reconnectionAttempts.delete(sessionId);
      } catch (error) {
        console.error(`Reconnection failed for ${sessionId}:`, error);
        await this.handleDisconnection(sessionId, error);
      }
    }, delay);
  }
}
```

---

### **שלב 8: Rate Limiting + Queue Management**

```javascript
// backend/src/services/MessageQueue.js
class MessageQueue {
  constructor() {
    this.queues = new Map(); // sessionId -> queue
    this.processing = new Map(); // sessionId -> boolean
    this.rateLimit = 20; // messages per minute
  }

  async enqueue(sessionId, message) {
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }

    this.queues.get(sessionId).push(message);

    if (!this.processing.get(sessionId)) {
      this.processQueue(sessionId);
    }
  }

  async processQueue(sessionId) {
    this.processing.set(sessionId, true);
    const queue = this.queues.get(sessionId);

    while (queue.length > 0) {
      const message = queue.shift();

      try {
        await this.sendMessage(sessionId, message);
        await this.delay(3000); // 3 seconds between messages
      } catch (error) {
        console.error('Failed to send message:', error);
        // Re-queue או שמור ב-failed_messages table
      }
    }

    this.processing.set(sessionId, false);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## 🎨 **שלב 9-10: Frontend Dashboard (Lovable)**

### Component Structure:

```
src/
├── pages/
│   ├── Dashboard.tsx          # ראשי
│   ├── Sessions.tsx           # ניהול חיבורים
│   ├── Groups.tsx             # ניהול קבוצות
│   ├── Messages.tsx           # היסטוריית הודעות
│   └── Settings.tsx           # הגדרות + webhook config
├── components/
│   ├── SessionCard.tsx        # תצוגת session יחיד
│   ├── QRScanner.tsx          # סריקת QR
│   ├── GroupManager.tsx       # ניהול קבוצה
│   └── UsageChart.tsx         # גרפי usage
└── hooks/
    ├── useSupabase.ts         # Supabase integration
    ├── useWebSocket.ts        # Socket.IO real-time
    └── useSessions.ts         # Session management
```

### דוגמה: `SessionCard.tsx`

```typescript
import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '@/lib/supabase';

export function SessionCard({ session }) {
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState(session.status);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_BACKEND_URL);

    socket.emit('join_session', session.session_id);

    socket.on('qr_updated', (data) => {
      setQrCode(data.qr);
    });

    socket.on('connection_status', (data) => {
      setStatus(data.status);
    });

    return () => socket.disconnect();
  }, [session.session_id]);

  return (
    <div className="border rounded-lg p-4">
      <h3>{session.phone_number || 'Not connected'}</h3>
      <p>Status: {status}</p>

      {status === 'connecting' && qrCode && (
        <img src={qrCode} alt="QR Code" className="w-48 h-48" />
      )}

      {status === 'connected' && (
        <div className="flex gap-2">
          <button onClick={() => handleDisconnect(session.session_id)}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 💰 **שלב 12: Pricing Model + Monetization**

### מודל תמחור מומלץ:

```javascript
const PRICING_TIERS = {
  free: {
    name: 'Free',
    price: 0,
    max_accounts: 1,
    max_messages_per_month: 500,
    features: ['1 WhatsApp account', 'Basic group management', 'GHL integration']
  },
  starter: {
    name: 'Starter',
    price: 29, // USD/month
    max_accounts: 3,
    max_messages_per_month: 5000,
    features: ['3 WhatsApp accounts', 'Advanced group features', 'Priority support']
  },
  pro: {
    name: 'Pro',
    price: 99,
    max_accounts: 10,
    max_messages_per_month: 50000,
    features: ['10 accounts', 'Unlimited groups', 'Custom webhooks', 'API access']
  },
  enterprise: {
    name: 'Enterprise',
    price: 299,
    max_accounts: -1, // unlimited
    max_messages_per_month: -1,
    features: ['Unlimited accounts', 'White-label', 'Dedicated support', 'SLA']
  }
};
```

#### Stripe Integration:

```javascript
// backend/src/api/routes/billing.js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/create-checkout', authenticateUser, async (req, res) => {
  const { tier } = req.body;
  const { user, organization } = req;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price: PRICING_TIERS[tier].stripe_price_id,
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    client_reference_id: organization.id,
  });

  res.json({ url: session.url });
});

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orgId = session.client_reference_id;

    // עדכן organization tier
    await pool.query(
      `UPDATE organizations SET subscription_tier = $1 WHERE id = $2`,
      ['pro', orgId]
    );
  }

  res.json({ received: true });
});
```

---

## 📊 **שלב 11: Monitoring + Logging**

```javascript
// backend/src/services/MonitoringService.js
import pino from 'pino';
import axios from 'axios';

class MonitoringService {
  constructor() {
    this.logger = pino({ level: 'info' });
    this.metrics = {
      sessions_active: 0,
      messages_sent_today: 0,
      webhook_failures: 0
    };
  }

  async trackMetric(name, value) {
    this.metrics[name] = value;

    // שלח ל-external monitoring (Datadog, New Relic, etc.)
    if (process.env.DATADOG_API_KEY) {
      await axios.post('https://api.datadoghq.com/api/v1/series', {
        series: [{
          metric: `whatsapp_saas.${name}`,
          points: [[Date.now() / 1000, value]]
        }]
      }, {
        headers: { 'DD-API-KEY': process.env.DATADOG_API_KEY }
      });
    }
  }

  async logError(error, context = {}) {
    this.logger.error({ error, ...context });

    // שלח התראה אם קריטי
    if (context.severity === 'critical') {
      await this.sendAlert(error);
    }
  }

  async sendAlert(message) {
    // שלח Slack/Discord/Email
    await axios.post(process.env.SLACK_WEBHOOK_URL, {
      text: `🚨 Critical Error: ${message}`
    });
  }
}
```

---

## 🚢 **שלב 13: Railway Deployment**

### `railway.json`

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd backend && npm install"
  },
  "deploy": {
    "startCommand": "cd backend && npm start",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Environment Variables (Railway):

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
FRONTEND_URL=https://your-app.lovable.app
STRIPE_SECRET_KEY=sk_live_xxx
SESSION_STORAGE_PATH=/app/sessions
```

---

## 🔒 **שלב 14: Security Best Practices**

```javascript
// backend/src/middleware/security.js
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Rate limiting
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true
});

// Helmet for security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  }
});

// Input validation
export function validatePhoneNumber(phone) {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
}

// Prevent SQL injection
export function sanitizeInput(input) {
  return input.replace(/[^\w\s@.-]/gi, '');
}
```

#### הוסף ל-server.js:

```javascript
import { apiLimiter, securityHeaders } from './middleware/security.js';

app.use(securityHeaders);
app.use('/api/', apiLimiter);
```

---

## 🎯 **שלב 15: Go-to-Market Strategy**

### תכונות שמנצחות את GoGHL:

| תכונה | GoGHL | הפלטפורמה שלך |
|-------|-------|---------------|
| **Group Management** | ❌ לא קיים | ✅ מלא (broadcast, admin control) |
| **מחיר** | $49/חודש | **$29/חודש** (Starter) |
| **Multi-account** | מוגבל | ✅ עד 10 accounts (Pro) |
| **Session Persistence** | לא ברור | ✅ שמירה מלאה ב-Supabase |
| **Real-time Dashboard** | בסיסי | ✅ Socket.IO + Supabase Realtime |
| **Webhook Reliability** | ? | ✅ Retry logic + logging |
| **API Access** | לא | ✅ REST API מלא |

### אסטרטגיית שיווק (60 יום):

**שבועות 1-2: MVP + Beta Testing**
- השק גרסת Beta עם 10 משתמשים ראשונים
- אסוף feedback על group features
- תקן bugs קריטיים

**שבועות 3-4: Content Marketing**
- כתוב מדריך "How to manage WhatsApp groups in GHL" (SEO)
- צור וידאו YouTube: "GoGHL Alternative with Group Management"
- פרסם ב-Reddit r/GHL, r/WhatsAppBusinessAPI

**שבועות 5-6: Outreach**
- פנה ל-GHL Agency owners בלינקדאין
- הצע migration חינמית מ-GoGHL
- הרצה demo ב-Facebook groups של GHL

**שבועות 7-8: Scale**
- Google Ads על "GoGHL alternative"
- Affiliate program (20% עמלה)
- Case study עם לקוח ראשון

### Landing Page Headlines:

**עברית:**
> "נהל קבוצות WhatsApp ב-GHL שלך - משהו ש-GoGHL לא יכול"

**אנגלית:**
> "WhatsApp Group Management for GHL - The Feature GoGHL Doesn't Have"

---

## 📈 **מדדי הצלחה (KPIs)**

```javascript
// Track these metrics in your dashboard
const SUCCESS_METRICS = {
  week1: {
    target_users: 10,
    target_sessions: 15,
    target_messages: 500
  },
  week4: {
    target_users: 50,
    target_sessions: 100,
    target_messages: 10000
  },
  week8: {
    target_users: 200,
    target_sessions: 500,
    target_messages: 100000,
    target_revenue: 2000 // USD
  }
};
```

---

## ✅ **Checklist לפני Launch**

- [ ] Database schema deployed ב-Supabase
- [ ] RLS policies tested
- [ ] Session persistence working (test restart)
- [ ] Multi-account tested (3+ sessions)
- [ ] GHL webhook tested + retry logic
- [ ] Group management: create, add, remove, broadcast
- [ ] Frontend: QR scan, session list, group UI
- [ ] Authentication flow (signup → create org → add session)
- [ ] Rate limiting tested
- [ ] Error monitoring setup (Sentry/Datadog)
- [ ] Railway deployment successful
- [ ] Health check endpoint responding
- [ ] Stripe payment flow tested
- [ ] Usage tracking working
- [ ] Documentation written (API + user guide)
- [ ] Landing page live

---

## 🚀 **הצעד הבא**

בחר מאיפה להתחיל:

1. **Database First**: הרץ את הסכמה ב-Supabase SQL Editor
2. **Session Persistence**: עדכן את SessionManager לשמירה ב-DB
3. **Frontend**: צור Dashboard ב-Lovable עם components למעלה

אני כאן לעזור בכל צעד! רוצה שאתחיל ליישם אחד מהשלבים?
