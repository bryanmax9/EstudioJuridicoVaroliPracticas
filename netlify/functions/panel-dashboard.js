const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList } = require('./utils/panel-store');
const { filterTareas, filterExpedientes } = require('./utils/panel-rbac');
const { getArbitrajeData, normalizeSheetDate } = require('./utils/sheet-arbitraje');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  const [tareasAll, expedientesAll, clientes, usuarios, arbitrajeData] = await Promise.all([
    readList('tareas'),
    readList('expedientes'),
    readList('clientes'),
    readList('usuarios'),
    getArbitrajeData().catch(() => null), // Excel sync is a bonus, not a hard dependency for the dashboard
  ]);

  const tareas = filterTareas(session, tareasAll);
  const expedientes = filterExpedientes(session, expedientesAll);

  const clienteById = new Map(clientes.map((c) => [c.id, c]));
  const expedienteById = new Map(expedientes.map((e) => [e.id, e]));
  const usuarioById = new Map(usuarios.map((u) => [u.id, u]));

  // Tareas and reuniones are returned as flat, normalized lists (internal
  // records + the Excel PENDIENTES / REUNIONES tabs) so the Panel general
  // can filter and count them client-side — dates are ISO (YYYY-MM-DD) or
  // null, never the sheet's raw text.
  const excelTareas = arbitrajeData ? arbitrajeData.tareas : [];
  const excelReuniones = arbitrajeData ? arbitrajeData.reuniones : [];

  const tareasInternas = tareas.map((t) => ({
    id: `#${t.id}`,
    source: 'interno',
    titulo: t.titulo,
    categoria: t.estado,
    cliente: t.clienteId ? clienteById.get(t.clienteId)?.nombre || null : null,
    tipoProceso: t.expedienteId ? expedienteById.get(t.expedienteId)?.materia || null : null,
    expediente: t.expedienteId ? expedienteById.get(t.expedienteId)?.numero || null : null,
    responsable: usuarioById.get(t.responsableId)?.nombre || null,
    prioridad: '',
    fechaLimite: normalizeSheetDate(t.fechaLimite),
  }));

  const tareasExcel = excelTareas.map((t) => ({
    id: t.id || null,
    source: 'excel',
    titulo: t.tarea || t.observaciones || '(sin descripción)',
    categoria: t.categoria,
    cliente: t.cliente || null,
    tipoProceso: t.tipoProceso || null,
    expediente: t.expediente || t.idCaso || null,
    responsable: t.responsable || null,
    prioridad: t.prioridad || '',
    fechaLimite: normalizeSheetDate(t.fechaLimite),
  }));

  const reuniones = excelReuniones.map((r) => ({
    id: r.id || null,
    cliente: r.cliente || null,
    asunto: r.asunto || null,
    fecha: normalizeSheetDate(r.fecha),
    hora: r.hora || '',
    modalidad: r.modalidad || '',
    estado: r.estado || '',
    responsable: r.responsable || null,
    link: r.link || '',
  }));

  return jsonResponse(200, {
    tareas: [...tareasInternas, ...tareasExcel],
    reuniones,
    clientesTotal: clientes.length + (arbitrajeData ? arbitrajeData.clientes.length : 0),
    sync: arbitrajeData ? { fetchedAt: arbitrajeData.fetchedAt, stale: !!arbitrajeData.stale } : null,
  });
};
