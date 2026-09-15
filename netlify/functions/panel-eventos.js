const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');
const { getArbitrajeData, normalizeSheetDate } = require('./utils/sheet-arbitraje');

const VALID_TIPOS = ['Reunión', 'Audiencia', 'Vencimiento', 'Tarea'];
const MAX_BODY_BYTES = 8 * 1024;

// Read-only calendar events computed from the Excel sync — matches
// agenda-panel.html: reuniones (all), vencimientos (judicial cases only,
// per the reference), and tareas, each only when they carry a real date.
function excelEventosFrom(data) {
  const eventos = [];

  data.reuniones.forEach((r) => {
    const fecha = normalizeSheetDate(r.fecha);
    if (!fecha) return;
    eventos.push({
      id: `excel-reu-${r.id || eventos.length}`,
      source: 'excel',
      tipo: 'Reunión',
      titulo: `Reunión — ${r.cliente || 'Sin cliente'}`,
      fecha,
      hora: r.hora,
      cliente: r.cliente,
      modalidad: r.modalidad,
      descripcion: r.asunto,
      link: r.link,
    });
  });

  data.procesosJudiciales.forEach((p) => {
    const fecha = normalizeSheetDate(p.fechaLimite);
    if (!fecha) return;
    eventos.push({
      id: `excel-venc-${p.idCaso}`,
      source: 'excel',
      tipo: 'Vencimiento',
      titulo: `Vencimiento judicial — ${p.cliente}`,
      fecha,
      hora: '',
      cliente: p.cliente,
      modalidad: '',
      descripcion: `Expediente ${p.numeroExpediente || p.codigo || p.idCaso}.${p.accionPendiente ? ' ' + p.accionPendiente : ''}`,
      link: p.numeroExpediente || p.codigo || p.idCaso,
    });
  });

  data.tareas.forEach((t) => {
    const fecha = normalizeSheetDate(t.fechaLimite);
    if (!fecha) return;
    eventos.push({
      id: `excel-tarea-${t.id}`,
      source: 'excel',
      tipo: 'Tarea',
      titulo: `Tarea — ${t.cliente || 'Sin cliente'}`,
      fecha,
      hora: '',
      cliente: t.cliente,
      modalidad: '',
      descripcion: t.observaciones || t.tarea,
      link: t.link || t.expediente || t.idCaso,
    });
  });

  return eventos;
}

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  if (event.httpMethod === 'GET') {
    const [internos, arbitrajeData] = await Promise.all([
      readList('eventos'),
      getArbitrajeData().catch(() => null), // Excel sync is a bonus, not a hard dependency
    ]);
    const excelEventos = arbitrajeData ? excelEventosFrom(arbitrajeData) : [];
    return jsonResponse(200, {
      eventos: [...internos.map((e) => ({ ...e, source: 'interno' })), ...excelEventos],
    });
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
    const titulo = String(body.titulo || '').trim().slice(0, 200);
    const fecha = String(body.fecha || '').slice(0, 10);
    if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return jsonResponse(400, { error: 'Título y fecha son obligatorios.' });
    }
    const tipo = VALID_TIPOS.includes(body.tipo) ? body.tipo : 'Reunión';

    const eventos = await readList('eventos');
    const nuevo = {
      id: nextId(eventos),
      titulo,
      fecha,
      hora: String(body.hora || '').slice(0, 10),
      tipo,
      modalidad: String(body.modalidad || '').slice(0, 20),
      cliente: String(body.cliente || '').trim().slice(0, 200),
      descripcion: String(body.descripcion || '').trim().slice(0, 1000),
      link: String(body.link || '').trim().slice(0, 300),
      creadoPor: session.uid,
      createdAt: new Date().toISOString(),
    };
    eventos.push(nuevo);
    await writeList('eventos', eventos);

    return jsonResponse(201, { evento: nuevo });
  }

  if (event.httpMethod === 'PATCH') {
    const id = Number(body.id);
    if (!id) return jsonResponse(400, { error: 'Falta el id del evento.' });

    const eventos = await readList('eventos');
    const evento = eventos.find((e) => e.id === id);
    if (!evento) return jsonResponse(404, { error: 'Evento no encontrado.' });

    if (body.titulo !== undefined) evento.titulo = String(body.titulo).trim().slice(0, 200);
    if (body.fecha !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) evento.fecha = body.fecha;
    if (body.hora !== undefined) evento.hora = String(body.hora).slice(0, 10);
    if (body.tipo !== undefined && VALID_TIPOS.includes(body.tipo)) evento.tipo = body.tipo;
    if (body.modalidad !== undefined) evento.modalidad = String(body.modalidad).slice(0, 20);
    if (body.cliente !== undefined) evento.cliente = String(body.cliente).trim().slice(0, 200);
    if (body.descripcion !== undefined) evento.descripcion = String(body.descripcion).trim().slice(0, 1000);
    if (body.link !== undefined) evento.link = String(body.link).trim().slice(0, 300);

    await writeList('eventos', eventos);
    return jsonResponse(200, { evento });
  }

  if (event.httpMethod === 'DELETE') {
    const id = Number(body.id);
    if (!id) return jsonResponse(400, { error: 'Falta el id del evento.' });

    const eventos = await readList('eventos');
    const filtrados = eventos.filter((e) => e.id !== id);
    if (filtrados.length === eventos.length) return jsonResponse(404, { error: 'Evento no encontrado.' });

    await writeList('eventos', filtrados);
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};
