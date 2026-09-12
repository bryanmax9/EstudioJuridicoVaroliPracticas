const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList } = require('./utils/panel-store');
const { filterTareas, filterExpedientes } = require('./utils/panel-rbac');
const { getArbitrajeData, categorizeEstado } = require('./utils/sheet-arbitraje');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  const [tareasAll, expedientesAll, clientes, arbitrajeData] = await Promise.all([
    readList('tareas'),
    readList('expedientes'),
    readList('clientes'),
    getArbitrajeData().catch(() => null), // Excel sync is a bonus, not a hard dependency for the dashboard
  ]);

  const tareas = filterTareas(session, tareasAll);
  const expedientes = filterExpedientes(session, expedientesAll);

  const clienteById = new Map(clientes.map((c) => [c.id, c]));
  const expedienteById = new Map(expedientes.map((e) => [e.id, e]));

  // Excel-sourced expedientes (one row = one expediente, confirmed with the
  // workbook owner) get folded into the same three buckets as internally
  // created tareas, so the KPIs reflect the real caseload that actually
  // lives in the spreadsheet today rather than the still-empty internal DB.
  const excelExpedientes = arbitrajeData ? arbitrajeData.clientes.flatMap((c) => c.pendientes) : [];

  let pendientesPorHacer = tareas.filter((t) => t.estado === 'pendiente').length;
  let pendientesEnTramite = tareas.filter((t) => t.estado === 'en_tramite').length;
  let pendientesCompletos = tareas.filter((t) => t.estado === 'completo').length;
  excelExpedientes.forEach((e) => {
    const cat = categorizeEstado(e.estado);
    if (cat === 'pendiente') pendientesPorHacer += 1;
    else if (cat === 'en_tramite') pendientesEnTramite += 1;
    else pendientesCompletos += 1;
  });

  const expedientesActivos =
    expedientes.filter((e) => e.estado === 'activo').length + (arbitrajeData ? arbitrajeData.totalExpedientesActivos : 0);

  // "Por área" only has data from the internal DB (materia field) for now —
  // the Excel sheet has no ÁREA column yet, so we don't fabricate one.
  const porArea = {};
  expedientes
    .filter((e) => e.estado === 'activo')
    .forEach((e) => {
      porArea[e.materia] = (porArea[e.materia] || 0) + 1;
    });
  const areaPendienteDeSheet = Object.keys(porArea).length === 0 && excelExpedientes.length > 0;

  const pendientesInternos = tareas
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((t) => ({
      titulo: t.titulo,
      estado: t.estado,
      clienteNombre: t.clienteId ? clienteById.get(t.clienteId)?.nombre || null : null,
      expedienteNumero: t.expedienteId ? expedienteById.get(t.expedienteId)?.numero || null : null,
    }));

  const pendientesExcel = excelExpedientes
    .slice()
    .sort((a, b) => (/urgente/i.test(b.prioridad) ? 1 : 0) - (/urgente/i.test(a.prioridad) ? 1 : 0))
    .map((e) => ({
      titulo: e.descripcion,
      estado: categorizeEstado(e.estado),
      clienteNombre: e.cliente || null,
      expedienteNumero: e.numero ? `N° ${e.numero}` : null,
    }));

  const pendientesRecientes = [...pendientesInternos, ...pendientesExcel].slice(0, 8);

  return jsonResponse(200, {
    pendientesPorHacer,
    pendientesEnTramite,
    pendientesCompletos,
    expedientesActivos,
    expedientesPorArea: porArea,
    areaPendienteDeSheet,
    pendientesRecientes,
    totalPendientes: tareas.length + excelExpedientes.length,
  });
};
