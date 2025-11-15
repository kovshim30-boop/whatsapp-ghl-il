import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Message Queue - ניהול תור הודעות למניעת rate limiting
 *
 * WhatsApp מגביל:
 * - ~20 הודעות לדקה למספר יחיד
 * - ~1000 הודעות ליום
 *
 * Queue זה מוודא שלא נעבור את המגבלות
 */
class MessageQueue {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.queues = new Map(); // sessionId -> array of messages
    this.processing = new Map(); // sessionId -> boolean
    this.rateLimits = {
      messagesPerMinute: 20,
      delayBetweenMessages: 3000 // 3 seconds
    };
    this.stats = new Map(); // sessionId -> { sent: number, lastReset: Date }
  }

  /**
   * הוספת הודעה לתור
   * @param {string} sessionId
   * @param {object} message - { jid, content, type }
   * @returns {Promise<string>} queue ID
   */
  async enqueue(sessionId, message) {
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }

    const queueItem = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...message,
      enqueuedAt: new Date(),
      attempts: 0
    };

    this.queues.get(sessionId).push(queueItem);

    logger.info(`📨 Message queued: ${queueItem.id} for session ${sessionId}. Queue size: ${this.queues.get(sessionId).length}`);

    // התחל לעבד את התור אם לא כבר בעיבוד
    if (!this.processing.get(sessionId)) {
      this.processQueue(sessionId);
    }

    return queueItem.id;
  }

  /**
   * עיבוד תור הודעות לsession ספציפי
   * @param {string} sessionId
   */
  async processQueue(sessionId) {
    const queue = this.queues.get(sessionId);

    if (!queue || queue.length === 0) {
      this.processing.set(sessionId, false);
      return;
    }

    this.processing.set(sessionId, true);
    logger.info(`🚀 Processing queue for session ${sessionId}. ${queue.length} messages pending`);

    while (queue.length > 0) {
      const message = queue[0]; // peek (don't remove yet)

      try {
        // בדוק rate limiting
        if (await this.shouldThrottle(sessionId)) {
          logger.warn(`⚠️ Rate limit reached for ${sessionId}. Waiting...`);
          await this.delay(60000); // המתן דקה
          continue;
        }

        // שלח הודעה
        await this.sendMessage(sessionId, message);

        // הצלחה - הסר מהתור
        queue.shift();

        // עדכן stats
        this.updateStats(sessionId);

        logger.info(`✅ Message sent: ${message.id}. ${queue.length} remaining in queue`);

        // המתן בין הודעות למניעת spam
        await this.delay(this.rateLimits.delayBetweenMessages);
      } catch (error) {
        logger.error(`❌ Failed to send message ${message.id}:`, error.message);

        message.attempts++;

        // אם עברנו 3 ניסיונות, הסר מהתור
        if (message.attempts >= 3) {
          logger.error(`❌ Max attempts reached for message ${message.id}. Removing from queue.`);
          queue.shift();

          // שמור ב-failed_messages (אופציונלי)
          // await this.saveFailed(message);
        } else {
          // נסה שוב - העבר לסוף התור
          queue.shift();
          queue.push(message);
          await this.delay(5000); // המתן 5 שניות לפני ניסיון חוזר
        }
      }
    }

    this.processing.set(sessionId, false);
    logger.info(`✅ Queue processing completed for session ${sessionId}`);
  }

  /**
   * שליחת הודעה בפועל
   * @param {string} sessionId
   * @param {object} message
   */
  async sendMessage(sessionId, message) {
    const { jid, content, type = 'text' } = message;

    if (type === 'text') {
      await this.sessionManager.sendMessage(sessionId, jid, content);
    } else {
      // תמיכה בסוגי הודעות נוספים בעתיד (תמונות, וידאו, וכו')
      throw new Error(`Unsupported message type: ${type}`);
    }
  }

  /**
   * בדיקה אם צריך לעכב שליחה (rate limiting)
   * @param {string} sessionId
   * @returns {boolean}
   */
  async shouldThrottle(sessionId) {
    const stats = this.stats.get(sessionId);

    if (!stats) {
      return false;
    }

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60000);

    // אם עברה דקה, אפס את המונה
    if (stats.lastReset < minuteAgo) {
      this.stats.set(sessionId, { sent: 0, lastReset: now });
      return false;
    }

    // בדוק אם עברנו את המגבלה
    return stats.sent >= this.rateLimits.messagesPerMinute;
  }

  /**
   * עדכון סטטיסטיקות שליחה
   * @param {string} sessionId
   */
  updateStats(sessionId) {
    const stats = this.stats.get(sessionId) || { sent: 0, lastReset: new Date() };
    stats.sent++;
    this.stats.set(sessionId, stats);
  }

  /**
   * קבלת גודל התור לsession
   * @param {string} sessionId
   * @returns {number}
   */
  getQueueSize(sessionId) {
    const queue = this.queues.get(sessionId);
    return queue ? queue.length : 0;
  }

  /**
   * ניקוי תור (למשל אם session התנתק)
   * @param {string} sessionId
   */
  clearQueue(sessionId) {
    const size = this.getQueueSize(sessionId);
    this.queues.delete(sessionId);
    this.processing.delete(sessionId);
    logger.info(`🗑️ Cleared queue for session ${sessionId}. Removed ${size} messages`);
  }

  /**
   * קבלת סטטוס התור
   * @param {string} sessionId
   * @returns {object}
   */
  getQueueStatus(sessionId) {
    return {
      size: this.getQueueSize(sessionId),
      processing: this.processing.get(sessionId) || false,
      stats: this.stats.get(sessionId) || { sent: 0, lastReset: new Date() }
    };
  }

  /**
   * פונקציית עזר - המתנה
   * @param {number} ms
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * שליחה מיידית (bypass queue) - לשימוש חירום בלבד!
   * @param {string} sessionId
   * @param {string} jid
   * @param {string} content
   */
  async sendImmediate(sessionId, jid, content) {
    logger.warn(`⚠️ Bypassing queue for immediate send: ${sessionId} -> ${jid}`);
    await this.sessionManager.sendMessage(sessionId, jid, content);
    this.updateStats(sessionId);
  }

  /**
   * Bulk send - שליחה למספר מקבלים (broadcast)
   * @param {string} sessionId
   * @param {Array} recipients - array of jids
   * @param {string} content
   * @returns {Array} queue IDs
   */
  async sendBulk(sessionId, recipients, content) {
    logger.info(`📢 Bulk send: ${recipients.length} messages for session ${sessionId}`);

    const queueIds = [];

    for (const jid of recipients) {
      const queueId = await this.enqueue(sessionId, {
        jid,
        content,
        type: 'text'
      });
      queueIds.push(queueId);
    }

    return queueIds;
  }
}

export default MessageQueue;
