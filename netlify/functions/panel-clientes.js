const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { readList, writeList, nextId } = require('./utils/panel-store');
const { filterClientes } = require('./utils/panel-rbac');

const VALID_TIPOS = ['juridica', 'natural'];
const MAX_BODY_BYTES = 8 * 1024;

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  if (event.httpMethod === 'GET') {
    const [clientes, expedientes] = await Promise.all([readList('clientes'), readList('expedientes')]);
    const visible = filterClientes(session, clientes, expedientes);

    const withCounts = visible.map((c) => ({
      ...c,
      expedientesActivos: expedientes.filter((e) => e.clienteId === c.id && e.estado === 'activo').length,
    }));

    return jsonResponse(200, { clientes: withCounts });
  }

  if (event.httpMethod === 'POST') {
    const rawLen = Buffer.byteLength(event.body || '', 'utf8');
    if (rawLen > MAX_BODY_BYTES) return jsonResponse(413, { error: 'Solicitud demasiado grande.' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    const nombre = String(body.nombre || '').trim();
    const documento = String(body.documento || '').trim();
    const tipoPersona = VALID_TIPOS.includes(body.tipoPersona) ? body.tipoPersona : 'natural';
    const contacto = String(body.contacto || '').trim().slice(0, 200);
    const direccion = String(body.direccion || '').trim().slice(0, 300);

    if (!nombre || nombre.length > 200 || !documento || documento.length > 40) {
      return jsonResponse(400, { error: 'Nombre y documento son obligatorios.' });
    }

    const clientes = await readList('clientes');
    const nuevo = {
      id: nextId(clientes),
      tipoPersona,
      nombre,
      documento,
      contacto,
      direccion,
      estado: 'activo',
      creadoPor: session.uid,
      createdAt: new Date().toISOString(),
    };
    clientes.push(nuevo);
    await writeList('clientes', clientes);

    return jsonResponse(201, { cliente: { ...nuevo, expedientesActivos: 0 } });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};
