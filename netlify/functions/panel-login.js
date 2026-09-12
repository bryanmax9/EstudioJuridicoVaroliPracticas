const crypto = require('crypto');
const {
  createSessionToken,
  buildSessionCookie,
  hashPassword,
  verifyPassword,
  jsonResponse,
} = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY_BYTES = 4 * 1024;

// Fixed salt used only to keep hashing time constant for unknown emails, so
// failed attempts don't leak which check failed.
const DUMMY_SALT = 'panel-login-dummy-salt-do-not-reuse';

// First-run bootstrap: if no users exist yet in the store, and the submitted
// credentials match the PANEL_ADMIN_* env vars, create the initial
// Jefe de Estudio account. After that, all accounts live in the store.
async function bootstrapAdminIfNeeded(users, email, password) {
  if (users.length > 0) return users;

  const adminEmail = (process.env.PANEL_ADMIN_EMAIL || '').trim().toLowerCase();
  const storedHash = process.env.PANEL_ADMIN_PASSWORD_HASH || '';
  if (!adminEmail || !storedHash || email !== adminEmail) return users;
  if (!verifyPassword(password, storedHash)) return users;

  const admin = {
    id: 1,
    nombre: 'Jefe de Estudio',
    correo: adminEmail,
    rol: 'jefe_estudio',
    estado: 'activo',
    passwordHash: storedHash,
  };
  const updated = [admin];
  await writeList('users', updated);
  return updated;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  const rawLen = Buffer.byteLength(event.body || '', 'utf8');
  if (rawLen > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'Solicitud demasiado grande.' });
  }

  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return jsonResponse(415, { error: 'Content-Type debe ser application/json.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const genericError = () => jsonResponse(401, { error: 'Correo o contraseña incorrectos.' });

  if (!email || !password || email.length > 200 || password.length > 200 || !EMAIL_RE.test(email)) {
    return genericError();
  }

  const sessionSecret = process.env.PANEL_SESSION_SECRET || '';
  if (!sessionSecret) {
    console.error('[panel-login] Falta la variable de entorno PANEL_SESSION_SECRET');
    return jsonResponse(500, { error: 'El panel todavía no está configurado.' });
  }

  let users = await readList('users');
  users = await bootstrapAdminIfNeeded(users, email, password);

  const user = users.find((u) => u.correo === email);

  // Always hash the submitted password (against the real hash's salt when the
  // user exists, otherwise a dummy one) so response time doesn't reveal
  // whether the email was recognized.
  const [realSalt, realHex] = user ? (user.passwordHash || '').split(':') : [];
  const computedHex = hashPassword(password, realSalt || DUMMY_SALT);

  let passwordMatches = false;
  if (user && realHex) {
    const a = Buffer.from(computedHex, 'hex');
    const b = Buffer.from(realHex, 'hex');
    passwordMatches = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!user || !passwordMatches) {
    return genericError();
  }

  if (user.estado !== 'activo') {
    return jsonResponse(403, {
      error: 'Tu usuario está inactivo. Contacta al Jefe de Estudio para activarlo.',
    });
  }

  const token = createSessionToken(user, sessionSecret);
  return jsonResponse(200, { success: true }, { 'Set-Cookie': buildSessionCookie(token) });
};
