const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList } = require('./utils/panel-store');
const { filterTareas, filterExpedientes } = require('./utils/panel-rbac');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  const [tareasAll, expedientesAll, clientes] = await Promise.all([
    readList('tareas'),
    readList('expedientes'),
    readList('clientes'),
  ]);

  const tareas = filterTareas(session, tareasAll);
  const expedientes = filterExpedientes(session, expedientesAll);

  const clienteById = new Map(clientes.map((c) => [c.id, c]));
  const expedienteById = new Map(expedientes.map((e) => [e.id, e]));

  const pendientesPorHacer = tareas.filter((t) => t.estado === 'pendiente').length;
  const pendientesEnTramite = tareas.filter((t) => t.estado === 'en_tramite').length;
  const pendientesCompletos = tareas.filter((t) => t.estado === 'completo').length;
  const expedientesActivos = expedientes.filter((e) => e.estado === 'activo').length;

  const porArea = {};
  expedientes
    .filter((e) => e.estado === 'activo')
    .forEach((e) => {
      porArea[e.materia] = (porArea[e.materia] || 0) + 1;
    });

  const pendientesRecientes = tareas
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map((t) => ({
      ...t,
      clienteNombre: t.clienteId ? clienteById.get(t.clienteId)?.nombre || null : null,
      expedienteNumero: t.expedienteId ? expedienteById.get(t.expedienteId)?.numero || null : null,
    }));

  return jsonResponse(200, {
    pendientesPorHacer,
    pendientesEnTramite,
    pendientesCompletos,
    expedientesActivos,
    expedientesPorArea: porArea,
    pendientesRecientes,
    totalPendientes: tareas.length,
  });
};
