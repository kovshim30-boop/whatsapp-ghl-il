import pool from '../config/database.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * SessionPersistence - מנהל שמירה וטעינה של WhatsApp sessions מ-Supabase
 * פותר את הבעיה של sessions שנעלמים אחרי restart
 */
class SessionPersistence {
  /**
   * שמירת auth state של Baileys ב-DB
   * @param {string} sessionId - מזהה ייחודי של הsession
   * @param {object} authState - auth state מ-Baileys (creds, keys)
   */
  async saveAuthState(sessionId, authState) {
    try {
      const authStateJson = JSON.stringify(authState);

      await pool.query(
        `UPDATE whatsapp_sessions
         SET auth_state = $1::jsonb, updated_at = NOW()
         WHERE session_id = $2`,
        [authStateJson, sessionId]
      );

      logger.debug(`✅ Saved auth state for session: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ Failed to save auth state for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * טעינת auth state מה-DB (לשחזור session אחרי restart)
   * @param {string} sessionId
   * @returns {object|null} auth state או null אם לא נמצא
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

      logger.info(`⚠️ No auth state found for session: ${sessionId}`);
      return null;
    } catch (error) {
      logger.error(`❌ Failed to load auth state for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * עדכון סטטוס session (connecting, connected, disconnected, error)
   * @param {string} sessionId
   * @param {string} status
   * @param {string} phoneNumber - (אופציונלי) מספר הטלפון
   * @param {string} errorMessage - (אופציונלי) הודעת שגיאה
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
      logger.error(`❌ Failed to update session status for ${sessionId}:`, error);
    }
  }

  /**
   * שמירת QR code ל-DB (לתצוגה ב-frontend)
   * @param {string} sessionId
   * @param {string} qrCode - QR code string או data URL
   */
  async saveQRCode(sessionId, qrCode) {
    try {
      await pool.query(
        `UPDATE whatsapp_sessions
         SET qr_code = $1, updated_at = NOW()
         WHERE session_id = $2`,
        [qrCode, sessionId]
      );

      logger.debug(`✅ Saved QR code for session: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ Failed to save QR code for ${sessionId}:`, error);
    }
  }

  /**
   * קבלת כל ה-sessions הפעילים (לטעינה בזמן הפעלת השרת)
   * @returns {Array} רשימת sessions עם auth_state
   */
  async getActiveSessions() {
    try {
      const result = await pool.query(
        `SELECT session_id, organization_id, auth_state, phone_number
         FROM whatsapp_sessions
         WHERE status IN ('connected', 'connecting')
         AND auth_state IS NOT NULL`
      );

      logger.info(`📦 Found ${result.rows.length} active sessions to restore`);
      return result.rows;
    } catch (error) {
      logger.error(`❌ Failed to get active sessions:`, error);
      return [];
    }
  }

  /**
   * יצירת session חדש ב-DB
   * @param {string} sessionId
   * @param {string} organizationId
   * @returns {object} session data
   */
  async createSessionRecord(sessionId, organizationId) {
    try {
      const result = await pool.query(
        `INSERT INTO whatsapp_sessions (session_id, organization_id, status)
         VALUES ($1, $2, 'connecting')
         RETURNING id, session_id, organization_id, status, created_at`,
        [sessionId, organizationId]
      );

      logger.info(`✅ Created session record: ${sessionId} for org: ${organizationId}`);
      return result.rows[0];
    } catch (error) {
      logger.error(`❌ Failed to create session record:`, error);
      throw error;
    }
  }

  /**
   * מחיקת session מה-DB
   * @param {string} sessionId
   */
  async deleteSession(sessionId) {
    try {
      await pool.query(
        `DELETE FROM whatsapp_sessions WHERE session_id = $1`,
        [sessionId]
      );

      logger.info(`✅ Deleted session record: ${sessionId}`);
    } catch (error) {
      logger.error(`❌ Failed to delete session ${sessionId}:`, error);
    }
  }

  /**
   * בדיקת אם organization עברה את מגבלת החשבונות
   * @param {string} organizationId
   * @returns {object} { count, limit, canAdd }
   */
  async checkAccountLimit(organizationId) {
    try {
      const result = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM whatsapp_sessions WHERE organization_id = $1 AND status != 'error') as current_count,
           o.max_accounts as max_allowed
         FROM organizations o
         WHERE o.id = $1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        throw new Error('Organization not found');
      }

      const { current_count, max_allowed } = result.rows[0];
      const canAdd = parseInt(current_count) < parseInt(max_allowed);

      logger.info(`📊 Org ${organizationId}: ${current_count}/${max_allowed} accounts used`);

      return {
        count: parseInt(current_count),
        limit: parseInt(max_allowed),
        canAdd
      };
    } catch (error) {
      logger.error(`❌ Failed to check account limit:`, error);
      throw error;
    }
  }

  /**
   * שמירת הודעה ב-DB
   * @param {object} messageData
   * @returns {object} saved message
   */
  async saveMessage(messageData) {
    try {
      const {
        sessionId,
        organizationId,
        messageId,
        direction,
        fromNumber,
        toNumber,
        content,
        messageType = 'text',
        isGroupMessage = false,
        groupJid = null
      } = messageData;

      const result = await pool.query(
        `INSERT INTO messages (
          session_id, organization_id, message_id, direction,
          from_number, to_number, content, message_type,
          is_group_message, group_jid
        )
        VALUES (
          (SELECT id FROM whatsapp_sessions WHERE session_id = $1),
          $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
        )
        RETURNING id, message_id, timestamp`,
        [
          sessionId, organizationId, messageId, direction,
          fromNumber, toNumber, JSON.stringify(content), messageType,
          isGroupMessage, groupJid
        ]
      );

      logger.info(`✅ Saved message ${messageId} to DB`);
      return result.rows[0];
    } catch (error) {
      logger.error(`❌ Failed to save message:`, error);
      throw error;
    }
  }

  /**
   * קבלת הודעות שטרם סונכרנו ל-GHL
   * @param {string} organizationId
   * @returns {Array} הודעות ממתינות
   */
  async getPendingGHLSync(organizationId) {
    try {
      const result = await pool.query(
        `SELECT * FROM messages
         WHERE organization_id = $1
         AND synced_to_ghl = false
         AND direction = 'inbound'
         ORDER BY timestamp ASC
         LIMIT 100`,
        [organizationId]
      );

      logger.info(`📬 Found ${result.rows.length} messages pending GHL sync`);
      return result.rows;
    } catch (error) {
      logger.error(`❌ Failed to get pending GHL messages:`, error);
      return [];
    }
  }

  /**
   * סימון הודעה כסונכרנה ל-GHL
   * @param {string} messageId
   * @param {string} ghlMessageId
   */
  async markMessageSynced(messageId, ghlMessageId = null) {
    try {
      await pool.query(
        `UPDATE messages
         SET synced_to_ghl = true, ghl_message_id = $1
         WHERE id = $2`,
        [ghlMessageId, messageId]
      );

      logger.debug(`✅ Marked message ${messageId} as synced to GHL`);
    } catch (error) {
      logger.error(`❌ Failed to mark message as synced:`, error);
    }
  }

  /**
   * שמירת קבוצה ב-DB
   * @param {object} groupData
   */
  async saveGroup(groupData) {
    try {
      const { sessionId, organizationId, groupJid, name, description, participantCount, isAdmin } = groupData;

      const result = await pool.query(
        `INSERT INTO whatsapp_groups (
          session_id, organization_id, group_jid, name, description, participant_count, is_admin
        )
        VALUES (
          (SELECT id FROM whatsapp_sessions WHERE session_id = $1),
          $2, $3, $4, $5, $6, $7
        )
        ON CONFLICT (session_id, group_jid)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          participant_count = EXCLUDED.participant_count,
          is_admin = EXCLUDED.is_admin,
          updated_at = NOW()
        RETURNING id`,
        [sessionId, organizationId, groupJid, name, description, participantCount, isAdmin]
      );

      logger.info(`✅ Saved group ${name} (${groupJid})`);
      return result.rows[0];
    } catch (error) {
      logger.error(`❌ Failed to save group:`, error);
      throw error;
    }
  }

  /**
   * עדכון מונה reconnect attempts
   * @param {string} sessionId
   * @param {number} attempts
   */
  async updateReconnectAttempts(sessionId, attempts) {
    try {
      await pool.query(
        `UPDATE whatsapp_sessions
         SET reconnect_attempts = $1
         WHERE session_id = $2`,
        [attempts, sessionId]
      );
    } catch (error) {
      logger.error(`❌ Failed to update reconnect attempts:`, error);
    }
  }

  /**
   * איפוס reconnect attempts (אחרי התחברות מוצלחת)
   * @param {string} sessionId
   */
  async resetReconnectAttempts(sessionId) {
    await this.updateReconnectAttempts(sessionId, 0);
  }

  /**
   * שמירת log של webhook
   * @param {object} logData
   */
  async logWebhook(logData) {
    try {
      const { organizationId, messageId, webhookUrl, payload, status, responseStatus, responseBody, errorMessage } = logData;

      await pool.query(
        `INSERT INTO webhook_logs (
          organization_id, message_id, webhook_url, payload,
          status, response_status, response_body, error_message
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
        [organizationId, messageId, webhookUrl, JSON.stringify(payload), status, responseStatus, responseBody, errorMessage]
      );

      logger.debug(`✅ Logged webhook attempt for message ${messageId}`);
    } catch (error) {
      logger.error(`❌ Failed to log webhook:`, error);
    }
  }
}

export default SessionPersistence;
