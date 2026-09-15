const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');
const { filterExpedientes, canSeeExpediente, isAdmin } = require('./utils/panel-rbac');
const { getArbitrajeData } = require('./utils/sheet-arbitraje');

const VALID_MATERIAS = [
  'Contrataciones del Estado',
  'Laboral corporativo',
  'Derecho administrativo',
  'Derecho penal',
  'Civil y comercial',
];
const VALID_ETAPAS = ['Diagnóstico', 'Estrategia', 'Ejecución', 'Seguimiento', 'Cerrado'];
const MAX_BODY_BYTES = 8 * 1024;

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  if (event.httpMethod === 'GET') {
    const [expedientes, arbitrajeData] = await Promise.all([
      readList('expedientes'),
      getArbitrajeData().catch(() => null), // Excel sync is a bonus, not a hard dependency
    ]);
    const internos = filterExpedientes(session, expedientes).map((e) => ({ ...e, source: 'interno' }));

    // Excel-sourced expedientes: one row per PROCESOS JUDICIALES/ARBITRALES
    // case plus one per PENDIENTES task (read-only, sheet stays their source
    // of truth). The "Expediente" column falls back to ID CASO / ID TAREA
    // when the sheet's own EXPEDIENTE value is blank, so nothing shows up
    // empty. clienteId is built the same way panel-clientes.js builds it for
    // Excel clients, so name lookups on the frontend resolve correctly.
    const excelExpedientes = [];
    if (arbitrajeData) {
      const clienteIdByNombre = new Map(arbitrajeData.clientes.map((c) => [c.nombre, `excel-${c.id || c.nombre}`]));
      [...arbitrajeData.procesosJudiciales, ...arbitrajeData.procesosArbitrales].forEach((p) => {
        excelExpedientes.push({
          id: `excel-${p.idCaso || p.numeroExpediente || p.codigo}`,
          source: 'excel',
          numero: p.numeroExpediente || p.codigo || p.idCaso || '—',
          clienteId: clienteIdByNombre.get(p.cliente) || null,
          materia: p.tipoProceso || (p.tipo === 'judicial' ? 'Proceso judicial' : 'Proceso arbitral'),
          etapaKanban: null,
          estado: p.abierto ? 'activo' : 'cerrado',
        });
      });
      arbitrajeData.tareas.forEach((t) => {
        excelExpedientes.push({
          id: `excel-tarea-${t.id}`,
          source: 'excel',
          numero: t.expediente || t.idCaso || t.id || '—',
          clienteId: clienteIdByNombre.get(t.cliente) || null,
          materia: t.tipoProceso || null,
          etapaKanban: null,
          estado: t.categoria === 'completo' ? 'cerrado' : 'activo',
        });
      });
    }

    return jsonResponse(200, { expedientes: [...internos, ...excelExpedientes] });
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
    const clienteId = Number(body.clienteId);
    const materia = VALID_MATERIAS.includes(body.materia) ? body.materia : null;
    const juzgadoTribunal = String(body.juzgadoTribunal || '').trim().slice(0, 200);
    const fuero = String(body.fuero || '').trim().slice(0, 100);
    const partesInvolucradas = String(body.partesInvolucradas || '').trim().slice(0, 500);

    if (!clienteId || !materia) {
      return jsonResponse(400, { error: 'Cliente y materia son obligatorios.' });
    }

    const clientes = await readList('clientes');
    if (!clientes.some((c) => c.id === clienteId)) {
      return jsonResponse(400, { error: 'El cliente indicado no existe.' });
    }

    const expedientes = await readList('expedientes');
    const asignados =
      isAdmin(session) && Array.isArray(body.asignados)
        ? body.asignados.map(Number).filter(Boolean)
        : [session.uid];

    const id = nextId(expedientes);
    const numero = `EXP-${new Date().getFullYear()}-${String(id).padStart(3, '0')}`;

    const nuevo = {
      id,
      numero,
      clienteId,
      materia,
      juzgadoTribunal,
      fuero,
      partesInvolucradas,
      etapaKanban: 'Diagnóstico',
      estado: 'activo',
      asignados,
      createdAt: new Date().toISOString(),
    };
    expedientes.push(nuevo);
    await writeList('expedientes', expedientes);

    return jsonResponse(201, { expediente: nuevo });
  }

  if (event.httpMethod === 'PATCH') {
    const id = Number(body.id);
    if (!id) return jsonResponse(400, { error: 'Falta el id del expediente.' });

    const expedientes = await readList('expedientes');
    const expediente = expedientes.find((e) => e.id === id);
    if (!expediente) return jsonResponse(404, { error: 'Expediente no encontrado.' });
    if (!canSeeExpediente(session, expediente)) {
      return jsonResponse(403, { error: 'No tienes acceso a este expediente.' });
    }

    if (body.etapaKanban !== undefined) {
      if (!VALID_ETAPAS.includes(body.etapaKanban)) return jsonResponse(400, { error: 'Etapa inválida.' });
      expediente.etapaKanban = body.etapaKanban;
      if (body.etapaKanban === 'Cerrado') expediente.estado = 'cerrado';
    }
    if (body.estado !== undefined) {
      if (!isAdmin(session)) return jsonResponse(403, { error: 'Solo el Jefe de Estudio puede cerrar expedientes.' });
      if (!['activo', 'cerrado'].includes(body.estado)) return jsonResponse(400, { error: 'Estado inválido.' });
      expediente.estado = body.estado;
    }

    await writeList('expedientes', expedientes);
    return jsonResponse(200, { expediente });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};
