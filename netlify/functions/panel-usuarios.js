const crypto = require('crypto');
const { requireSession, jsonResponse, hashPassword } = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');
const { isAdmin } = require('./utils/panel-rbac');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VALID_ROLES = ['jefe_estudio', 'asistente_legal'];
const MAX_BODY_BYTES = 4 * 1024;

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

function randomTempPassword() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, url-safe
}

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });
  if (!isAdmin(session)) return jsonResponse(403, { error: 'Solo el Jefe de Estudio puede gestionar usuarios.' });

  if (event.httpMethod === 'GET') {
    const users = await readList('users');
    return jsonResponse(200, { usuarios: users.map(publicUser) });
  }

  const rawLen = Buffer.byteLength(event.body || '', 'utf8');
  if (rawLen > MAX_BODY_BYTES) return jsonResponse(413, { error: 'Solicitud demasiado grande.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  if (event.httpMethod === 'POST') {
    const nombre = String(body.nombre || '').trim();
    const correo = String(body.correo || '').trim().toLowerCase();
    const rol = VALID_ROLES.includes(body.rol) ? body.rol : 'asistente_legal';

    if (!nombre || nombre.length > 120 || !correo || !EMAIL_RE.test(correo) || correo.length > 200) {
      return jsonResponse(400, { error: 'Nombre o correo inválido.' });
    }

    const users = await readList('users');
    if (users.some((u) => u.correo === correo)) {
      return jsonResponse(409, { error: 'Ya existe un usuario con ese correo.' });
    }

    const tempPassword = randomTempPassword();
    const salt = crypto.randomBytes(16).toString('hex');
    const newUser = {
      id: nextId(users),
      nombre,
      correo,
      rol,
      estado: 'inactivo', // starts inactive until the Jefe de Estudio validates access
      passwordHash: `${salt}:${hashPassword(tempPassword, salt)}`,
    };
    users.push(newUser);
    await writeList('users', users);

    return jsonResponse(201, {
      usuario: publicUser(newUser),
      tempPassword, // returned once — share it with the new user out of band
    });
  }

  if (event.httpMethod === 'PATCH') {
    const id = Number(body.id);
    const estado = body.estado;
    if (!id || !['activo', 'inactivo'].includes(estado)) {
      return jsonResponse(400, { error: 'Datos inválidos.' });
    }

    const users = await readList('users');
    const user = users.find((u) => u.id === id);
    if (!user) return jsonResponse(404, { error: 'Usuario no encontrado.' });

    user.estado = estado;
    await writeList('users', users);
    return jsonResponse(200, { usuario: publicUser(user) });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};
