const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList } = require('./utils/panel-store');
const { filterTareas, filterExpedientes } = require('./utils/panel-rbac');
const { getArbitrajeData } = require('./utils/sheet-arbitraje');

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

  // Excel-sourced tareas (from the PENDIENTES tab — genuinely tasks, distinct
  // from the case-level PROCESOS tabs) get folded into the same three
  // buckets as internally created tareas, so the KPIs reflect the real
  // caseload that actually lives in the spreadsheet today rather than the
  // still-empty internal DB.
  const excelTareas = arbitrajeData ? arbitrajeData.tareas : [];

  let pendientesPorHacer = tareas.filter((t) => t.estado === 'pendiente').length;
  let pendientesEnTramite = tareas.filter((t) => t.estado === 'en_tramite').length;
  let pendientesCompletos = tareas.filter((t) => t.estado === 'completo').length;
  excelTareas.forEach((t) => {
    if (t.categoria === 'pendiente') pendientesPorHacer += 1;
    else if (t.categoria === 'en_tramite') pendientesEnTramite += 1;
    else pendientesCompletos += 1;
  });

  const expedientesActivos =
    expedientes.filter((e) => e.estado === 'activo').length + (arbitrajeData ? arbitrajeData.totalExpedientesActivos : 0);

  const pendientesInternos = tareas
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((t) => ({
      idTarea: `#${t.id}`,
      titulo: t.titulo,
      estado: t.estado,
      clienteNombre: t.clienteId ? clienteById.get(t.clienteId)?.nombre || null : null,
      tipoProceso: t.expedienteId ? expedienteById.get(t.expedienteId)?.materia || null : null,
      expediente: t.expedienteId ? expedienteById.get(t.expedienteId)?.numero || null : null,
      responsable: usuarioById.get(t.responsableId)?.nombre || null,
    }));

  const pendientesExcel = excelTareas
    .slice()
    .sort((a, b) => (/urgente/i.test(b.prioridad) ? 1 : 0) - (/urgente/i.test(a.prioridad) ? 1 : 0))
    .map((t) => ({
      idTarea: t.id || null,
      titulo: t.tarea,
      estado: t.categoria,
      clienteNombre: t.cliente || null,
      tipoProceso: t.tipoProceso || null,
      expediente: t.expediente || t.idCaso || null,
      responsable: t.responsable || null,
    }));

  const pendientesRecientes = [...pendientesInternos, ...pendientesExcel].slice(0, 8);

  return jsonResponse(200, {
    pendientesPorHacer,
    pendientesEnTramite,
    pendientesCompletos,
    expedientesActivos,
    pendientesRecientes,
    totalPendientes: tareas.length + excelTareas.length,
  });
};
