const crypto = require('crypto');
const { createSessionToken, buildSessionCookie, hashPassword } = require('./utils/panel-auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 4 * 1024;

// Fixed salt used only to keep the hashing time constant when the email
// doesn't match anything, so failed attempts don't leak which check failed.
const DUMMY_SALT = 'panel-login-dummy-salt-do-not-reuse';

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const rawLen = Buffer.byteLength(event.body || '', 'utf8');
  if (rawLen > MAX_BODY_BYTES) {
    return json(413, { error: 'Solicitud demasiado grande.' });
  }

  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return json(415, { error: 'Content-Type debe ser application/json.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const genericError = () => json(401, { error: 'Correo o contraseña incorrectos.' });

  if (!email || !password || email.length > 200 || password.length > 200 || !EMAIL_RE.test(email)) {
    return genericError();
  }

  const adminEmail = (process.env.PANEL_ADMIN_EMAIL || '').trim().toLowerCase();
  const storedHash = process.env.PANEL_ADMIN_PASSWORD_HASH || '';
  const sessionSecret = process.env.PANEL_SESSION_SECRET || '';

  if (!adminEmail || !storedHash || !sessionSecret) {
    console.error('[panel-login] Faltan variables de entorno PANEL_ADMIN_EMAIL / PANEL_ADMIN_PASSWORD_HASH / PANEL_SESSION_SECRET');
    return json(500, { error: 'El panel todavía no está configurado.' });
  }

  const [storedSalt, storedHex] = storedHash.split(':');
  const emailMatches = email === adminEmail && Boolean(storedSalt) && Boolean(storedHex);

  // Always hash the submitted password (against the real salt when the email
  // matches, otherwise a dummy one) so response time doesn't reveal whether
  // the email was recognized.
  const computedHex = hashPassword(password, emailMatches ? storedSalt : DUMMY_SALT);

  let passwordMatches = false;
  if (emailMatches) {
    const a = Buffer.from(computedHex, 'hex');
    const b = Buffer.from(storedHex, 'hex');
    passwordMatches = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!emailMatches || !passwordMatches) {
    return genericError();
  }

  const token = createSessionToken(adminEmail, sessionSecret);
  return json(200, { success: true }, { 'Set-Cookie': buildSessionCookie(token) });
};
