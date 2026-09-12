function isAdmin(session) {
  return !!session && session.role === 'jefe_estudio';
}

// An Asistente Legal sees an expediente only if they're in its `asignados` list.
function canSeeExpediente(session, expediente) {
  if (isAdmin(session)) return true;
  return Array.isArray(expediente.asignados) && expediente.asignados.includes(session.uid);
}

// A cliente is visible to an Asistente Legal if they created it, or if they're
// assigned to at least one of its expedientes.
function canSeeCliente(session, cliente, expedientes) {
  if (isAdmin(session)) return true;
  if (cliente.creadoPor === session.uid) return true;
  return expedientes.some(
    (e) => e.clienteId === cliente.id && Array.isArray(e.asignados) && e.asignados.includes(session.uid)
  );
}

function canSeeTarea(session, tarea) {
  if (isAdmin(session)) return true;
  return tarea.responsableId === session.uid;
}

function filterClientes(session, clientes, expedientes) {
  if (isAdmin(session)) return clientes;
  return clientes.filter((c) => canSeeCliente(session, c, expedientes));
}

function filterExpedientes(session, expedientes) {
  if (isAdmin(session)) return expedientes;
  return expedientes.filter((e) => canSeeExpediente(session, e));
}

function filterTareas(session, tareas) {
  if (isAdmin(session)) return tareas;
  return tareas.filter((t) => canSeeTarea(session, t));
}

module.exports = {
  isAdmin,
  canSeeExpediente,
  canSeeCliente,
  canSeeTarea,
  filterClientes,
  filterExpedientes,
  filterTareas,
};
