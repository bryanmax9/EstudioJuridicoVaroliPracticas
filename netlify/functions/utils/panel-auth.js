const crypto = require('crypto');

const COOKIE_NAME = 'panel_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');
}

function createSessionToken(user, secret) {
  const payload = JSON.stringify({
    sub: user.correo,
    uid: user.id,
    role: user.rol,
    nombre: user.nombre,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const encoded = base64UrlEncode(payload);
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function buildSessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, storedHash) {
  const [salt, hex] = (storedHash || '').split(':');
  if (!salt || !hex) return false;
  const computed = hashPassword(password, salt);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reads and verifies the session cookie from a function event.
// Returns the decoded session payload ({sub, uid, role, nombre}) or null.
function requireSession(event) {
  const secret = process.env.PANEL_SESSION_SECRET || '';
  if (!secret) return null;
  const cookies = parseCookies(event.headers['cookie'] || event.headers['Cookie'] || '');
  return verifySessionToken(cookies[COOKIE_NAME], secret);
}

function jsonResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  hashPassword,
  verifyPassword,
  requireSession,
  jsonResponse,
};
