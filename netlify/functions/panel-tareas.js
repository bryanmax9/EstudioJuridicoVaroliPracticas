const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');
const { filterTareas, canSeeTarea, isAdmin } = require('./utils/panel-rbac');

const VALID_ESTADOS = ['pendiente', 'en_tramite', 'completo'];
const MAX_BODY_BYTES = 8 * 1024;

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  if (event.httpMethod === 'GET') {
    const tareas = await readList('tareas');
    return jsonResponse(200, { tareas: filterTareas(session, tareas) });
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
    const titulo = String(body.titulo || '').trim();
    if (!titulo || titulo.length > 200) return jsonResponse(400, { error: 'El título es obligatorio.' });

    const responsableId = isAdmin(session) && body.responsableId ? Number(body.responsableId) : session.uid;
    const clienteId = body.clienteId ? Number(body.clienteId) : null;
    const expedienteId = body.expedienteId ? Number(body.expedienteId) : null;
    const descripcion = String(body.descripcion || '').trim().slice(0, 1000);
    const fechaLimite = String(body.fechaLimite || '').slice(0, 10);

    const tareas = await readList('tareas');
    const nueva = {
      id: nextId(tareas),
      clienteId,
      expedienteId,
      titulo,
      descripcion,
      responsableId,
      estado: 'pendiente',
      fechaLimite,
      createdAt: new Date().toISOString(),
    };
    tareas.push(nueva);
    await writeList('tareas', tareas);

    return jsonResponse(201, { tarea: nueva });
  }

  if (event.httpMethod === 'PATCH') {
    const id = Number(body.id);
    if (!id || !VALID_ESTADOS.includes(body.estado)) {
      return jsonResponse(400, { error: 'Datos inválidos.' });
    }

    const tareas = await readList('tareas');
    const tarea = tareas.find((t) => t.id === id);
    if (!tarea) return jsonResponse(404, { error: 'Tarea no encontrada.' });
    if (!canSeeTarea(session, tarea)) return jsonResponse(403, { error: 'No tienes acceso a esta tarea.' });

    tarea.estado = body.estado;
    await writeList('tareas', tareas);
    return jsonResponse(200, { tarea });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};
