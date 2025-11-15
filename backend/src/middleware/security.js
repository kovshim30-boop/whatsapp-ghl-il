import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Rate Limiting - מונע spam ו-abuse
 */

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 דקות
  max: 100, // 100 בקשות לכל IP
  message: {
    error: 'Too many requests',
    message: 'Please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please try again later',
      retryAfter: '15 minutes'
    });
  }
});

// Stricter rate limit for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // רק 5 ניסיונות התחברות ב-15 דקות
  skipSuccessfulRequests: true, // אל תספור בקשות מוצלחות
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again later'
  }
});

// Rate limit for sending messages (prevent spam)
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 20, // 20 הודעות לדקה
  message: {
    error: 'Message rate limit exceeded',
    message: 'You can send up to 20 messages per minute'
  },
  keyGenerator: (req) => {
    // Rate limit per session_id instead of IP
    return req.body.session_id || req.ip;
  }
});

/**
 * Security Headers - Helmet
 * מגן מפני XSS, clickjacking, וכו'
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", process.env.FRONTEND_URL || '*'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

/**
 * Input Validation & Sanitization
 */

// Validate phone number format
export function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  // WhatsApp phone format: +[country code][number]
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/[\s-]/g, ''));
}

// Validate session_id format (prevent injection)
export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  // Only alphanumeric, hyphens, underscores
  const sessionRegex = /^[a-zA-Z0-9_-]+$/;
  return sessionRegex.test(sessionId) && sessionId.length <= 100;
}

// Sanitize user input (prevent XSS)
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim();
}

// Middleware: Validate request body
export function validateRequestBody(requiredFields = []) {
  return (req, res, next) => {
    const missingFields = requiredFields.filter(field => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing: missingFields
      });
    }

    next();
  };
}

/**
 * CORS Configuration
 */
export const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173', // Vite dev server
      'http://localhost:3000',
      'https://lovable.app'
    ].filter(Boolean);

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || allowedOrigins.includes(origin) || origin.includes('lovable.app')) {
      callback(null, true);
    } else {
      logger.warn(`⚠️ Blocked CORS request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

/**
 * Request Logger Middleware
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    };

    if (res.statusCode >= 400) {
      logger.warn(logData);
    } else {
      logger.info(logData);
    }
  });

  next();
}

/**
 * Error Handler Middleware
 */
export function errorHandler(err, req, res, next) {
  logger.error('❌ Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Don't leak error details in production
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
}

/**
 * Webhook Signature Validation (for GHL webhooks)
 */
export function validateWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('⚠️ WEBHOOK_SECRET not configured');
    return next();
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  // TODO: Implement actual signature verification
  // const crypto = require('crypto');
  // const hash = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex');
  // if (hash !== signature) { return res.status(401).json({ error: 'Invalid signature' }); }

  next();
}

/**
 * IP Whitelist Middleware (optional, for admin endpoints)
 */
export function ipWhitelist(allowedIPs = []) {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;

    if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
      logger.warn(`⚠️ Blocked request from IP: ${clientIP}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  };
}
