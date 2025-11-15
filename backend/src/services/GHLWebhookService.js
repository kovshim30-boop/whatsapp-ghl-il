import axios from 'axios';
import pool from '../config/database.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * GHL Webhook Service - סנכרון הודעות WhatsApp ל-GoHighLevel
 *
 * תכונות:
 * - שליחת הודעות ל-GHL דרך webhook
 * - Retry logic עם exponential backoff
 * - לוגים מפורטים של כל ניסיון
 * - תמיכה בסנכרון contacts אוטומטי
 */
class GHLWebhookService {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds initial delay
  }

  /**
   * קבלת תצורת GHL של organization
   * @param {string} organizationId
   * @returns {object} { webhook_url, ghl_api_key, ghl_location_id }
   */
  async getOrgConfig(organizationId) {
    try {
      const { rows } = await pool.query(
        'SELECT webhook_url, ghl_api_key, ghl_location_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (rows.length === 0) {
        throw new Error('Organization not found');
      }

      return rows[0];
    } catch (error) {
      logger.error(`❌ Failed to get org config for ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * שליחת הודעה ל-GHL webhook
   * @param {string} organizationId
   * @param {object} messageData - { from_number, to_number, content, timestamp, message_id }
   * @returns {Promise<object>} response data
   */
  async sendMessageToGHL(organizationId, messageData) {
    const org = await this.getOrgConfig(organizationId);

    if (!org.webhook_url) {
      logger.warn(`⚠️ No webhook URL configured for org: ${organizationId}`);
      return null;
    }

    // בנה payload לפי פורמט GHL
    const payload = {
      type: 'whatsapp_message',
      timestamp: messageData.timestamp || new Date().toISOString(),
      data: {
        from: this.formatPhoneNumber(messageData.from_number),
        to: this.formatPhoneNumber(messageData.to_number),
        message: messageData.content?.text || messageData.content?.conversation || '',
        messageId: messageData.message_id,
        messageType: messageData.message_type || 'text',
        isGroupMessage: messageData.is_group_message || false,
        groupJid: messageData.group_jid || null
      }
    };

    logger.info(`📤 Sending message to GHL: ${messageData.message_id}`);

    try {
      const response = await axios.post(org.webhook_url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': org.ghl_api_key ? `Bearer ${org.ghl_api_key}` : undefined,
          'X-Location-Id': org.ghl_location_id || undefined
        },
        timeout: 10000 // 10 seconds timeout
      });

      logger.info(`✅ Message sent to GHL successfully: ${messageData.message_id}`);

      // שמור log
      await this.logWebhook({
        organizationId,
        messageId: messageData.id,
        webhookUrl: org.webhook_url,
        payload,
        status: 'success',
        responseStatus: response.status,
        responseBody: JSON.stringify(response.data)
      });

      // עדכן שההודעה סונכרנה
      if (messageData.id) {
        await pool.query(
          `UPDATE messages
           SET synced_to_ghl = true, ghl_message_id = $1
           WHERE id = $2`,
          [response.data?.messageId || response.data?.id, messageData.id]
        );
      }

      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to send message to GHL:`, error.message);

      // שמור log של הכישלון
      await this.logWebhook({
        organizationId,
        messageId: messageData.id,
        webhookUrl: org.webhook_url,
        payload,
        status: 'failed',
        responseStatus: error.response?.status,
        responseBody: error.response?.data ? JSON.stringify(error.response.data) : null,
        errorMessage: error.message
      });

      // נסה שוב
      await this.scheduleRetry(organizationId, messageData);

      throw error;
    }
  }

  /**
   * תזמון retry עם exponential backoff
   * @param {string} organizationId
   * @param {object} messageData
   * @param {number} retryCount - מספר הניסיון הנוכחי
   */
  async scheduleRetry(organizationId, messageData, retryCount = 0) {
    if (retryCount >= this.maxRetries) {
      logger.error(`❌ Max retries reached for message: ${messageData.id}`);

      // עדכן סטטוס ב-DB
      if (messageData.id) {
        await pool.query(
          `UPDATE messages SET status = 'failed' WHERE id = $1`,
          [messageData.id]
        );
      }

      return;
    }

    const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff: 2s, 4s, 8s

    logger.info(`🔄 Scheduling retry ${retryCount + 1}/${this.maxRetries} for message ${messageData.id} in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.sendMessageToGHL(organizationId, messageData);
      } catch (error) {
        await this.scheduleRetry(organizationId, messageData, retryCount + 1);
      }
    }, delay);
  }

  /**
   * סנכרון contact ל-GHL (אופציונלי)
   * @param {string} organizationId
   * @param {object} contactData - { phone, name, email }
   */
  async syncContactToGHL(organizationId, contactData) {
    const org = await this.getOrgConfig(organizationId);

    if (!org.ghl_api_key || !org.ghl_location_id) {
      logger.warn('⚠️ GHL API credentials not configured');
      return null;
    }

    const payload = {
      phone: this.formatPhoneNumber(contactData.phone),
      name: contactData.name || '',
      email: contactData.email || '',
      source: 'WhatsApp',
      locationId: org.ghl_location_id
    };

    try {
      const response = await axios.post(
        'https://rest.gohighlevel.com/v1/contacts/',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${org.ghl_api_key}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`✅ Contact synced to GHL: ${contactData.phone}`);
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to sync contact to GHL:`, error.message);
      throw error;
    }
  }

  /**
   * שליחת הודעה דרך GHL API (הכיוון ההפוך - מ-GHL ל-WhatsApp)
   * @param {string} organizationId
   * @param {string} sessionId
   * @param {string} toNumber
   * @param {string} message
   */
  async sendMessageFromGHL(organizationId, sessionId, toNumber, message) {
    // זה יטופל על ידי ה-sessionManager
    // פונקציה זו נועדה לקבל webhooks מ-GHL ולשלוח דרך WhatsApp
    logger.info(`📥 Received message from GHL to send via WhatsApp`);

    // TODO: Call sessionManager.sendMessage()
    return { success: true };
  }

  /**
   * שמירת log של webhook ב-DB
   * @param {object} logData
   */
  async logWebhook(logData) {
    try {
      await pool.query(
        `INSERT INTO webhook_logs (
          organization_id, message_id, webhook_url, payload,
          status, response_status, response_body, error_message
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
        [
          logData.organizationId,
          logData.messageId || null,
          logData.webhookUrl,
          JSON.stringify(logData.payload),
          logData.status,
          logData.responseStatus || null,
          logData.responseBody || null,
          logData.errorMessage || null
        ]
      );

      logger.debug(`✅ Logged webhook attempt`);
    } catch (error) {
      logger.error(`❌ Failed to log webhook:`, error);
    }
  }

  /**
   * קבלת כל ההודעות שטרם סונכרנו ל-GHL
   * @param {string} organizationId
   * @returns {Array} הודעות ממתינות
   */
  async getPendingMessages(organizationId) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM messages
         WHERE organization_id = $1
         AND synced_to_ghl = false
         AND direction = 'inbound'
         AND status != 'failed'
         ORDER BY timestamp ASC
         LIMIT 100`,
        [organizationId]
      );

      logger.info(`📬 Found ${rows.length} messages pending GHL sync`);
      return rows;
    } catch (error) {
      logger.error(`❌ Failed to get pending messages:`, error);
      return [];
    }
  }

  /**
   * סנכרון כל ההודעות הממתינות (cron job)
   */
  async syncPendingMessages() {
    logger.info('🔄 Starting pending messages sync...');

    try {
      // קבל את כל ה-organizations עם webhook מוגדר
      const { rows: orgs } = await pool.query(
        'SELECT id FROM organizations WHERE webhook_url IS NOT NULL'
      );

      for (const org of orgs) {
        const pendingMessages = await this.getPendingMessages(org.id);

        for (const msg of pendingMessages) {
          try {
            await this.sendMessageToGHL(org.id, msg);
          } catch (error) {
            logger.error(`❌ Failed to sync message ${msg.id}:`, error);
          }
        }
      }

      logger.info('✅ Pending messages sync completed');
    } catch (error) {
      logger.error('❌ Failed to sync pending messages:', error);
    }
  }

  /**
   * פורמט מספר טלפון ל-GHL (E.164 format)
   * @param {string} phoneNumber
   * @returns {string} formatted number
   */
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';

    // הסר @s.whatsapp.net suffix
    let cleaned = phoneNumber.replace('@s.whatsapp.net', '').replace('@c.us', '');

    // הסר רווחים, מקפים
    cleaned = cleaned.replace(/[\s-]/g, '');

    // הוסף + אם חסר
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }
}

export default GHLWebhookService;
