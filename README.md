# 🚀 WhatsApp-GHL SaaS Platform

> Multi-tenant WhatsApp to GoHighLevel integration platform with advanced group management

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

## 🎯 **מה זה?**

פלטפורמה SaaS שמאפשרת לעסקים לחבר מספר חשבונות WhatsApp ל-CRM של GoHighLevel, עם **ניהול קבוצות מתקדם** - יכולת שלא קיימת ב-GoGHL.ai (המתחרה העיקרי).

### ✨ **תכונות מרכזיות**

- ✅ **Multi-tenant Architecture** - כל לקוח עם organization נפרד
- ✅ **Session Persistence** - Sessions שרודים restart של השרת
- ✅ **Advanced Group Management** - יצירה, הוספת משתתפים, שליחה קבוצתית, promote to admin
- ✅ **Real-time Updates** - Socket.IO לעדכונים בזמן אמת
- ✅ **GHL Webhook Integration** - סנכרון הודעות ל-GoHighLevel עם retry logic
- ✅ **Rate Limiting** - מניעת spam ו-blocking מ-WhatsApp
- ✅ **Auto-Reconnection** - Exponential backoff במקרה של disconnection
- ✅ **Usage Tracking** - מעקב אחר שימוש להתעריפים
- ✅ **Subscription Tiers** - Free, Starter, Pro, Enterprise

---

## 🏗️ **ארכיטקטורה**

```
┌─────────────────┐
│   Frontend      │  Lovable (React + TypeScript)
│   Dashboard     │  → Real-time WebSocket updates
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Backend API   │  Node.js + Express + Socket.IO
│   (Railway)     │  → Session Manager (Baileys)
└────────┬────────┘  → Message Queue
         │            → GHL Webhook Service
         ▼
┌─────────────────┐
│   Supabase      │  PostgreSQL + Auth + Realtime
│   Database      │  → RLS Policies
└─────────────────┘  → Session Persistence
```

---

## 📦 **התקנה**

### דרישות מוקדמות:

- Node.js >= 18.0.0
- Supabase account (free tier מספיק להתחלה)
- Railway account (לדפלוי backend)
- Lovable account (לפיתוח frontend)

### 1. Clone הפרוייקט

```bash
git clone https://github.com/YOUR-USERNAME/whatsapp-ghl-il.git
cd whatsapp-ghl-il
```

### 2. התקן dependencies

```bash
cd backend
npm install
```

### 3. הגדר Supabase

#### א. צור פרוייקט ב-Supabase

1. לך ל-https://supabase.com/dashboard
2. צור פרוייקט חדש
3. המתן עד שהפרוייקט מוכן

#### ב. הרץ את סכמת הDB

1. לך ל-**SQL Editor** בSupabase Dashboard
2. העלה את הקובץ `supabase/schema.sql`
3. הרץ את הSQL
4. וודא שכל הטבלאות נוצרו בהצלחה

#### ג. קבל את ה-credentials

```bash
# Supabase Dashboard → Settings → API

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Supabase Dashboard → Settings → Database → Connection string
DATABASE_URL=postgresql://postgres:...
```

### 4. הגדר Environment Variables

```bash
cp backend/.env.example backend/.env
# ערוך את backend/.env עם ה-credentials שלך
```

### 5. הרץ את השרת (לוקלית)

```bash
cd backend
npm run dev
```

השרת יעלה על `http://localhost:3000`

---

## 🚢 **Deployment ל-Railway**

### 1. צור פרוייקט ב-Railway

```bash
# התקן Railway CLI
npm install -g @railway/cli

# התחבר
railway login

# צור פרוייקט חדש
railway init
```

### 2. הגדר Environment Variables ב-Railway

לך ל-Railway Dashboard → Your Project → Variables, והוסף:

```
NODE_ENV=production
DATABASE_URL=<Supabase connection string>
SUPABASE_URL=<your supabase url>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
FRONTEND_URL=https://your-app.lovable.app
SESSION_STORAGE_PATH=/app/sessions
```

### 3. Deploy

```bash
railway up
```

Railway יזהה אוטומטית את `backend/package.json` ויעלה את השרת.

---

## 🔐 **סכמת Database**

### טבלאות מרכזיות:

| טבלה | תיאור |
|------|-------|
| `organizations` | Multi-tenancy - כל לקוח = organization |
| `whatsapp_sessions` | Sessions של WhatsApp (עם auth_state) |
| `messages` | היסטוריית הודעות |
| `whatsapp_groups` | קבוצות WhatsApp |
| `group_participants` | משתתפים בקבוצות |
| `usage_tracking` | מעקב שימוש לתעריפים |
| `webhook_logs` | לוגים של webhooks ל-GHL |

ראה `supabase/schema.sql` לפרטים מלאים.

---

## 📡 **API Endpoints**

### Sessions

```
POST   /api/sessions/create          # צור session חדש
GET    /api/sessions/:id/status      # סטטוס של session
GET    /api/sessions                 # רשימת כל הsessions
POST   /api/sessions/:id/disconnect  # התנתק
```

### Messages

```
POST   /api/messages/send            # שלח הודעה
GET    /api/messages/:session_id     # קבל הודעות
```

### Groups

```
GET    /api/groups/:session_id/groups              # רשימת קבוצות
POST   /api/groups/:session_id/create              # צור קבוצה
POST   /api/groups/:group_jid/add-participants     # הוסף משתתפים
POST   /api/groups/:group_jid/remove-participant   # הסר משתתף
POST   /api/groups/:group_jid/promote              # Promote to admin
POST   /api/groups/:group_jid/broadcast            # שלח לכל חברי הקבוצה
GET    /api/groups/:group_jid/participants         # רשימת משתתפים
POST   /api/groups/:group_jid/settings             # עדכן הגדרות קבוצה
```

### Health

```
GET    /api/health                   # Health check
```

---

## 🔧 **שימוש בקוד**

### דוגמה: צירת session חדש

```javascript
// Frontend (React)
const socket = io('https://your-backend.railway.app');

const createSession = async () => {
  const response = await fetch('/api/sessions/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({
      session_id: 'user_123_session_1',
      user_id: 'user_123',
      sub_account_id: 'sub_account_456'
    })
  });

  const data = await response.json();

  // Listen for QR code
  socket.emit('join_session', data.session_id);

  socket.on('qr_updated', (data) => {
    // הצג QR code למשתמש
    setQrCode(data.qr);
  });

  socket.on('connection_status', (data) => {
    if (data.status === 'connected') {
      console.log('✅ Connected!', data.phoneNumber);
    }
  });
};
```

### דוגמה: שליחת הודעה לקבוצה

```javascript
const response = await fetch('/api/groups/120363123456789012@g.us/broadcast', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({
    session_id: 'user_123_session_1',
    message: 'שלום לכולם! 👋'
  })
});
```

---

## 💰 **מודל תמחור**

| Plan | מחיר | חשבונות | הודעות/חודש |
|------|------|---------|-------------|
| **Free** | $0 | 1 | 500 |
| **Starter** | $29 | 3 | 5,000 |
| **Pro** | $99 | 10 | 50,000 |
| **Enterprise** | $299 | ∞ | ∞ |

### מה מבדל אותנו מ-GoGHL?

| תכונה | GoGHL | אנחנו |
|-------|-------|-------|
| Group Management | ❌ | ✅ |
| מחיר Starter | $49 | **$29** |
| Multi-account | 3 | 10 (Pro) |
| Session Persistence | ? | ✅ |
| API Access | ❌ | ✅ |

---

## 🛠️ **פיתוח**

### מבנה הפרוייקט

```
whatsapp-ghl-il/
├── backend/
│   ├── src/
│   │   ├── api/routes/        # Express routes
│   │   ├── whatsapp/          # SessionManager, Persistence
│   │   ├── services/          # GHL, MessageQueue, Reconnection
│   │   ├── middleware/        # Auth, Security, Rate limiting
│   │   ├── config/            # Database config
│   │   └── server.js          # Entry point
│   ├── package.json
│   └── .env.example
├── supabase/
│   └── schema.sql             # Database schema
├── IMPLEMENTATION_PLAN.md     # תכנית יישום מפורטת
└── README.md
```

### הוספת תכונה חדשה

1. **תכנן**: עדכן את `IMPLEMENTATION_PLAN.md`
2. **DB**: הוסף טבלאות/עמודות לsכמה אם נדרש
3. **Backend**: צור service/route חדש
4. **Frontend**: בנה UI ב-Lovable
5. **Test**: בדוק לוקלית
6. **Deploy**: Push ל-Railway + Lovable

---

## 🧪 **בדיקות**

```bash
# Run tests (כשיהיו)
npm test

# Lint code
npm run lint

# Check for security vulnerabilities
npm audit
```

---

## 📊 **Monitoring**

הפרוייקט תומך ב:

- **Datadog** - Metrics + APM
- **Sentry** - Error tracking
- **Slack** - Alerts

הגדר את ה-credentials ב-`.env`:

```bash
DATADOG_API_KEY=...
SENTRY_DSN=...
SLACK_WEBHOOK_URL=...
```

---

## 🐛 **Troubleshooting**

### Session לא מתחבר?

1. בדוק שה-QR code מוצג
2. ודא ש-`auth_state` נשמר ב-DB
3. בדוק logs: `railway logs`

### Webhook ל-GHL נכשל?

1. בדוק את `webhook_logs` table
2. ודא שה-webhook URL תקין
3. בדוק שה-GHL API key פעיל

### Rate limiting?

1. בדוק את `MESSAGE_RATE_LIMIT_PER_MINUTE` ב-`.env`
2. השתמש ב-MessageQueue לשליחות bulk
3. ודא שלא עוברים 20 הודעות/דקה למספר יחיד

---

## 🤝 **תרומה**

1. Fork the repo
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 **רישיון**

MIT License - ראה `LICENSE` לפרטים

---

## 🙏 **תודות**

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web library
- [Supabase](https://supabase.com) - Backend as a Service
- [Railway](https://railway.app) - Deployment platform
- [Lovable](https://lovable.app) - Frontend development

---

## 📞 **צור קשר**

- Issues: [GitHub Issues](https://github.com/YOUR-USERNAME/whatsapp-ghl-il/issues)
- Email: your-email@example.com
- Docs: `IMPLEMENTATION_PLAN.md`

---

**Built with ❤️ to compete with GoGHL.ai**
