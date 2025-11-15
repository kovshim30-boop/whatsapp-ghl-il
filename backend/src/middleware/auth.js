import pool from '../config/database.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Authentication Middleware - מאמת משתמשים באמצעות Supabase JWT
 *
 * בודק:
 * 1. Authorization header קיים
 * 2. Token תקין
 * 3. משתמש קיים במערכת
 * 4. טוען את ה-organization של המשתמש
 *
 * הוסף את req.user ו-req.organization
 */
export async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid authorization header',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // אימות עם Supabase (דורש @supabase/supabase-js package)
    // לצורך הדגמה, נבדוק את הטוקן מול הDB
    // בפועל תשתמש ב-supabase.auth.getUser(token)

    // TODO: התקן @supabase/supabase-js והשתמש ב-SDK
    // const { data: { user }, error } = await supabase.auth.getUser(token);

    // זמנית - נניח שה-token מכיל user_id (במציאות תפענח JWT)
    const userId = extractUserIdFromToken(token);

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // קבל את ה-organization של המשתמש
    const { rows } = await pool.query(
      'SELECT * FROM organizations WHERE owner_id = $1 LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'No organization found for user' });
    }

    const organization = rows[0];

    // הוסף לrequest
    req.user = { id: userId };
    req.organization = organization;

    logger.debug(`✅ Authenticated user ${userId} (org: ${organization.id})`);
    next();
  } catch (error) {
    logger.error('❌ Authentication failed:', error);
    return res.status(500).json({ error: 'Authentication failed', message: error.message });
  }
}

/**
 * פונקציה זמנית לחילוץ user_id מ-token
 * בפועל תשתמש ב-JWT library או Supabase SDK
 */
function extractUserIdFromToken(token) {
  try {
    // זמנית - נניח שהטוקן הוא פשוט user_id
    // בפועל: const payload = jwt.verify(token, process.env.JWT_SECRET);
    return token; // החלף בפענוח JWT אמיתי!
  } catch (error) {
    return null;
  }
}

/**
 * Optional Middleware - בדיקת הרשאות subscription
 * מוודא שהמשתמש לא עבר את מגבלת החשבונות/הודעות
 */
export async function checkSubscriptionLimits(req, res, next) {
  const { organization } = req;

  try {
    // בדוק מגבלת חשבונות
    const { rows: sessions } = await pool.query(
      `SELECT COUNT(*) as count
       FROM whatsapp_sessions
       WHERE organization_id = $1 AND status != 'error'`,
      [organization.id]
    );

    const sessionCount = parseInt(sessions[0].count);

    if (sessionCount >= organization.max_accounts) {
      return res.status(403).json({
        error: 'Account limit reached',
        message: `Your plan allows ${organization.max_accounts} accounts. Please upgrade.`,
        current: sessionCount,
        limit: organization.max_accounts
      });
    }

    // בדוק מגבלת הודעות (לחודש הנוכחי)
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

    const { rows: usage } = await pool.query(
      `SELECT messages_sent, messages_received
       FROM usage_tracking
       WHERE organization_id = $1 AND period_start = $2::date`,
      [organization.id, currentMonth]
    );

    if (usage.length > 0) {
      const totalMessages = (usage[0].messages_sent || 0) + (usage[0].messages_received || 0);

      if (totalMessages >= organization.max_messages_per_month) {
        return res.status(429).json({
          error: 'Message limit reached',
          message: `Your plan allows ${organization.max_messages_per_month} messages per month.`,
          current: totalMessages,
          limit: organization.max_messages_per_month
        });
      }
    }

    next();
  } catch (error) {
    logger.error('❌ Failed to check subscription limits:', error);
    return res.status(500).json({ error: 'Failed to check limits' });
  }
}

/**
 * Admin-only middleware (לעתיד)
 */
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
