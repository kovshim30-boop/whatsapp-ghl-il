import pino from 'pino';
import SessionPersistence from '../whatsapp/SessionPersistence.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Reconnection Manager - ניהול reconnection אוטומטי עם exponential backoff
 *
 * מטפל ב:
 * - Disconnections בגלל network issues
 * - Rate limiting של WhatsApp
 * - שגיאות זמניות
 * - Max attempts limit
 */
class ReconnectionManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.persistence = new SessionPersistence();
    this.reconnectionAttempts = new Map(); // sessionId -> attempt count
    this.maxAttempts = 5;
    this.baseDelay = 5000; // 5 seconds
    this.maxDelay = 300000; // 5 minutes
  }

  /**
   * טיפול ב-disconnection event
   * @param {string} sessionId
   * @param {object} reason - DisconnectReason from Baileys
   */
  async handleDisconnection(sessionId, reason) {
    const attempts = this.reconnectionAttempts.get(sessionId) || 0;

    logger.warn(`⚠️ Session ${sessionId} disconnected. Reason: ${reason?.error?.message || 'unknown'}`);

    // בדוק אם עברנו את מספר הניסיונות המקסימלי
    if (attempts >= this.maxAttempts) {
      logger.error(`❌ Max reconnection attempts (${this.maxAttempts}) reached for ${sessionId}`);

      await this.persistence.updateSessionStatus(
        sessionId,
        'error',
        null,
        `Max reconnection attempts exceeded (${this.maxAttempts})`
      );

      this.reconnectionAttempts.delete(sessionId);
      return;
    }

    // חשב delay עם exponential backoff
    const delay = Math.min(
      this.baseDelay * Math.pow(2, attempts),
      this.maxDelay
    );

    this.reconnectionAttempts.set(sessionId, attempts + 1);

    logger.info(
      `🔄 Scheduling reconnection for ${sessionId} in ${delay}ms (attempt ${attempts + 1}/${this.maxAttempts})`
    );

    // עדכן DB
    await this.persistence.updateReconnectAttempts(sessionId, attempts + 1);
    await this.persistence.updateSessionStatus(sessionId, 'connecting');

    // נסה להתחבר מחדש
    setTimeout(async () => {
      try {
        logger.info(`🔄 Attempting to reconnect session: ${sessionId}`);

        await this.sessionManager.createSession(sessionId);

        // הצלחה - אפס את המונה
        this.reconnectionAttempts.delete(sessionId);
        await this.persistence.resetReconnectAttempts(sessionId);

        logger.info(`✅ Session ${sessionId} reconnected successfully`);
      } catch (error) {
        logger.error(`❌ Reconnection failed for ${sessionId}:`, error.message);

        // נסה שוב רקורסיבית
        await this.handleDisconnection(sessionId, { error });
      }
    }, delay);
  }

  /**
   * טיפול בשגיאות rate limiting
   * @param {string} sessionId
   */
  async handleRateLimit(sessionId) {
    logger.warn(`⚠️ Rate limit detected for session: ${sessionId}`);

    // המתן זמן ארוך יותר במקרה של rate limiting (15 דקות)
    const delay = 15 * 60 * 1000; // 15 minutes

    await this.persistence.updateSessionStatus(
      sessionId,
      'connecting',
      null,
      'Rate limited by WhatsApp. Waiting 15 minutes...'
    );

    setTimeout(async () => {
      logger.info(`🔄 Retrying after rate limit: ${sessionId}`);
      await this.handleDisconnection(sessionId, { error: new Error('Rate limit recovery') });
    }, delay);
  }

  /**
   * איפוס ידני של reconnection attempts
   * @param {string} sessionId
   */
  resetAttempts(sessionId) {
    this.reconnectionAttempts.delete(sessionId);
    logger.info(`🔄 Reset reconnection attempts for ${sessionId}`);
  }

  /**
   * קבלת מספר הניסיונות הנוכחי
   * @param {string} sessionId
   * @returns {number}
   */
  getAttempts(sessionId) {
    return this.reconnectionAttempts.get(sessionId) || 0;
  }

  /**
   * בדיקה אם session במצב reconnection
   * @param {string} sessionId
   * @returns {boolean}
   */
  isReconnecting(sessionId) {
    return this.reconnectionAttempts.has(sessionId);
  }

  /**
   * ניקוי של sessions שלא הצליחו להתחבר
   */
  async cleanup() {
    logger.info('🧹 Cleaning up failed reconnection attempts...');

    const failedSessions = [];

    for (const [sessionId, attempts] of this.reconnectionAttempts.entries()) {
      if (attempts >= this.maxAttempts) {
        failedSessions.push(sessionId);
      }
    }

    for (const sessionId of failedSessions) {
      logger.warn(`🗑️ Removing failed session: ${sessionId}`);
      this.reconnectionAttempts.delete(sessionId);
      await this.persistence.updateSessionStatus(sessionId, 'error', null, 'Failed to reconnect');
    }

    logger.info(`✅ Cleanup completed. Removed ${failedSessions.length} failed sessions`);
  }
}

export default ReconnectionManager;
