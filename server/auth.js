/**
 * Kanpur Tactical GIS - Authentication & Cryptographic Session Module
 * Implements RFC 7519 compliant HS256 JWT issuance and verification,
 * timing-safe signature comparison, rate limiting, and session anti-tampering.
 */

const crypto = require('crypto');

// Tactical JWT Secret (Minimum 256-bit entropy)
const JWT_SECRET = process.env.JWT_SECRET || 'KANPUR_TACTICAL_GIS_SECRET_KEY_2026_APEX_DISPATCH_PRO';
const JWT_EXPIRY_SECONDS = 86400; // 24 hours

// In-Memory Rate Limiter (Sliding Window per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

/**
 * Clean expired rate limit records periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.resetTime > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

/**
 * Check and record an attempt against rate limits
 * @param {string} ip
 * @returns {boolean} true if allowed, false if rate limited
 */
function checkRateLimit(ip) {
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now - record.resetTime > RATE_LIMIT_WINDOW_MS) {
    record = { attempts: 1, resetTime: now };
    rateLimitMap.set(ip, record);
    return true;
  }
  record.attempts++;
  return record.attempts <= RATE_LIMIT_MAX_ATTEMPTS;
}

/**
 * Base64URL encode buffer or string
 */
function base64UrlEncode(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decode string to Buffer
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Issue a cryptographically signed HS256 JSON Web Token
 * @param {object} payload
 * @param {number} expiresInSeconds
 * @returns {string} Signed JWT string
 */
function signJwt(payload, expiresInSeconds = JWT_EXPIRY_SECONDS) {
  // If jsonwebtoken library is installed, we can try requiring it
  try {
    const jwt = require('jsonwebtoken');
    return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: expiresInSeconds });
  } catch (err) {
    // Zero-dependency native RFC 7519 implementation using Node.js crypto
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds
    };
    const header = { alg: 'HS256', typ: 'JWT' };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto.createHmac('sha256', JWT_SECRET)
      .update(signingInput)
      .digest();
    const encodedSignature = base64UrlEncode(signature);

    return `${signingInput}.${encodedSignature}`;
  }
}

/**
 * Verify a cryptographic HS256 JWT
 * @param {string} token
 * @returns {{ valid: boolean, payload: object|null, error: string|null }}
 */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, payload: null, error: 'Token missing or invalid format' };
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return { valid: true, payload: decoded, error: null };
  } catch (err) {
    // If jsonwebtoken is present and errored out, check if it was an auth error
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return { valid: false, payload: null, error: err.message };
    }

    // Native Node crypto fallback verification
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, payload: null, error: 'Malformed JWT structure' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET)
      .update(signingInput)
      .digest();
    const actualSignature = base64UrlDecode(encodedSignature);

    if (expectedSignature.length !== actualSignature.length ||
        !crypto.timingSafeEqual(expectedSignature, actualSignature)) {
      return { valid: false, payload: null, error: 'Cryptographic signature mismatch / token tampered' };
    }

    let payload;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    } catch (e) {
      return { valid: false, payload: null, error: 'Invalid payload encoding' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, payload: null, error: 'Token expired' };
    }

    return { valid: true, payload, error: null };
  }
}

/**
 * Authenticate login credentials
 * @param {object} credentials { pin, badgePin, username, password }
 * @param {string} clientIp
 * @returns {{ success: boolean, token?: string, user?: object, error?: string, status: number }}
 */
function authenticateUser(credentials, clientIp = '127.0.0.1') {
  if (!checkRateLimit(clientIp)) {
    return {
      success: false,
      status: 429,
      error: 'Too many authentication attempts. Please wait 60 seconds.'
    };
  }

  const pin = credentials.pin || credentials.badgePin;
  // Designated PIN is 1120
  if (pin === '1120') {
    const user = {
      sub: 'UP-KNP-POL-0482',
      name: 'SI Vikramaditya Rai',
      role: 'designated_personnel',
      callsign: 'APEX-COMMAND',
      badge: '1120',
      sector: 'Kanpur Apex Command HQ'
    };
    const token = signJwt(user, JWT_EXPIRY_SECONDS);
    return {
      success: true,
      status: 200,
      token,
      user,
      expiresIn: JWT_EXPIRY_SECONDS
    };
  }

  // Allow custom supervisor login
  if (credentials.username === 'apex' && credentials.password === 'kanpur112') {
    const user = {
      sub: 'UP-KNP-POL-HQ-01',
      name: 'DCP Tactical Operations',
      role: 'designated_personnel',
      callsign: 'APEX-COMMAND',
      badge: '1120',
      sector: 'Kanpur Commissionerate HQ'
    };
    const token = signJwt(user, JWT_EXPIRY_SECONDS);
    return {
      success: true,
      status: 200,
      token,
      user,
      expiresIn: JWT_EXPIRY_SECONDS
    };
  }

  return {
    success: false,
    status: 401,
    error: 'Unauthorized: Invalid tactical credentials'
  };
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRY_SECONDS,
  signJwt,
  verifyJwt,
  authenticateUser,
  checkRateLimit
};
