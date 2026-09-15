// Live read-only sync from the "Templo 2 - Sistema de Gestión" Google Drive
// workbook (an .xlsx file, not a native Google Sheet) into the panel.
//
// Requires GOOGLE_SERVICE_ACCOUNT_KEY (same service account already used for
// Drive uploads elsewhere in this repo) to be able to read the workbook —
// either shared directly with the service account, or (as with this file)
// shared as "anyone with the link" — since it's a binary Office file the
// Sheets API can't read directly, we pull the raw bytes via Drive and parse
// them here.
//
// This replaces an earlier, messier workbook ("Templo 2- Clientes") that had
// one tab per client with inconsistent columns. This one has a proper single
// table per concept (CLIENTES, PROCESOS JUDICIALES, PROCESOS ARBITRALES,
// PENDIENTES, REUNIONES) plus a CATALOGOS tab with the authoritative list of
// valid ESTADO/PRIORIDAD/etc. values.

const { google } = require('googleapis');
const XLSX = require('xlsx');
const { getPanelStore } = require('./panel-store');

const DEFAULT_FILE_ID = '1QwCh2xetKfB4plca6kPjMu1j4e1P02RU'; // "Templo 2 - Sistema de Gestión"
const CACHE_KEY = 'arbitraje-sheet-cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Per CATALOGOS: only these ESTADO DEL CASO values are closed. A few legacy
// synonyms ("LISTO", etc.) show up in real rows despite not being in the
// official list — treat those as closed too. Anything else (including a
// blank or unrecognized value) is treated as open, so a typo never silently
// drops a case from "activos".
const CLOSED_ESTADO_CASO = ['culminado', 'archivado', 'listo', 'finalizado', 'cerrado'];
const CLOSED_ESTADO_TAREA = ['completado', 'cancelado', 'listo', 'finalizado', 'cerrado'];

function isCasoAbierto(estado) {
  return !CLOSED_ESTADO_CASO.includes(normalize(estado));
}

// Buckets a tarea's ESTADO into the same three categories the panel's
// dashboard uses for internally-created tareas (pendiente/en_tramite/
// completo).
function categorizeEstado(estado) {
  const norm = normalize(estado);
  if (CLOSED_ESTADO_TAREA.includes(norm)) return 'completo';
  if (norm === 'pendiente') return 'pendiente';
  return 'en_tramite';
}

function getFileId() {
  return process.env.PANEL_ARBITRAJE_SHEET_ID || DEFAULT_FILE_ID;
}

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Falta configurar GOOGLE_SERVICE_ACCOUNT_KEY en las variables de entorno.');

  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no es un JSON válido.');
  }

  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

async function downloadWorkbook(fileId) {
  const drive = getDriveClient();
  let res;
  try {
    res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  } catch (err) {
    const status = err?.response?.status || err?.code;
    if (status === 404 || status === 403) {
      throw new Error(
        'No se pudo leer la hoja de cálculo. Verifica que el archivo esté compartido (como Lector) ' +
        'con la cuenta de servicio configurada en GOOGLE_SERVICE_ACCOUNT_KEY, o que el enlace siga activo.'
      );
    }
    throw err;
  }
  return XLSX.read(Buffer.from(res.data), { type: 'buffer', cellText: true });
}

function sheetRows(sheet) {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function cellLink(sheet, r, c) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = sheet[ref];
  return cell && cell.l && cell.l.Target ? cell.l.Target : null;
}

function findHeaderRow(rows, matchesFirstCol) {
  for (let i = 0; i < rows.length; i += 1) {
    if (matchesFirstCol(normalize(rows[i][0]))) return i;
  }
  return -1;
}

function isBlankRow(row) {
  return !row || row.every((cell) => !String(cell || '').trim());
}

// Builds a column-index map for a header row using a set of [canonicalKey,
// normalizedHeaderTest] rules — first matching rule per column wins, first
// matching column per key wins (matches by header name, not position, since
// column order isn't guaranteed to be identical across tabs/rows).
function mapHeader(headerRow, rules) {
  const header = headerRow.map(normalize);
  const colFor = {};
  header.forEach((h, i) => {
    if (!h) return;
    const rule = rules.find(([, test]) => test(h));
    if (rule && colFor[rule[0]] === undefined) colFor[rule[0]] = i;
  });
  return colFor;
}

function cell(row, colFor, key) {
  return colFor[key] !== undefined ? String(row[colFor[key]] || '').trim() : '';
}

// ---------- CLIENTES ----------
const CLIENTE_RULES = [
  ['id', (h) => h.includes('id') && h.includes('cliente')],
  ['nombre', (h) => h === 'cliente'],
  ['ruc', (h) => h === 'ruc'],
  ['contacto', (h) => h === 'contacto'],
  ['telefono', (h) => h.includes('telefono')],
  ['correo', (h) => h === 'correo'],
  ['responsable', (h) => h === 'responsable'],
  ['fechaIngreso', (h) => h.includes('fecha') && h.includes('ingreso')],
  ['estado', (h) => h.includes('estado') && h.includes('cliente')],
  ['totalCasos', (h) => (h.includes('total') || h.includes('numero')) && h.includes('casos')],
  ['casosJudiciales', (h) => h.includes('casos') && h.includes('judicial')],
  ['casosArbitrales', (h) => h.includes('casos') && h.includes('arbitral')],
  ['otrosCasos', (h) => h.includes('otros') && h.includes('casos')],
  ['driveLink', (h) => h.includes('link')],
  ['observaciones', (h) => h.includes('observacion')],
];

function parseClientesSheet(sheet) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (h) => h.includes('id') && h.includes('cliente'));
  if (headerIdx === -1) return [];
  const colFor = mapHeader(rows[headerIdx], CLIENTE_RULES);

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const nombre = cell(row, colFor, 'nombre');
    if (!nombre) continue;
    const linkCol = colFor.driveLink;
    out.push({
      id: cell(row, colFor, 'id'),
      nombre,
      ruc: cell(row, colFor, 'ruc'),
      contacto: cell(row, colFor, 'contacto'),
      telefono: cell(row, colFor, 'telefono'),
      correo: cell(row, colFor, 'correo'),
      responsable: cell(row, colFor, 'responsable'),
      fechaIngreso: cell(row, colFor, 'fechaIngreso'),
      estado: cell(row, colFor, 'estado'),
      totalCasos: Number(cell(row, colFor, 'totalCasos')) || 0,
      casosJudiciales: Number(cell(row, colFor, 'casosJudiciales')) || 0,
      casosArbitrales: Number(cell(row, colFor, 'casosArbitrales')) || 0,
      otrosCasos: Number(cell(row, colFor, 'otrosCasos')) || 0,
      driveLink: cell(row, colFor, 'driveLink'),
      driveLinkUrl: linkCol !== undefined ? cellLink(sheet, r, linkCol) : null,
      observaciones: cell(row, colFor, 'observaciones'),
    });
  }
  return out;
}

// ---------- PROCESOS (JUDICIALES + ARBITRALES share most columns) ----------
const PROCESO_RULES = [
  ['idCaso', (h) => h.includes('id') && h.includes('caso')],
  ['cliente', (h) => h === 'cliente'],
  ['sedeJuzgado', (h) => h.includes('sede') || h.includes('juzgado') || h.includes('centro')],
  ['especialidad', (h) => h === 'especialidad'],
  ['tipoProceso', (h) => h.includes('tipo') && (h.includes('proceso') || h.includes('porceso'))],
  ['codigo', (h) => h === 'codigo'],
  ['numeroExpediente', (h) => h.includes('numero') && h.includes('expediente')],
  ['partes', (h) => h.includes('partes')],
  ['demandante', (h) => h.includes('demandante')],
  ['demandado', (h) => h.includes('demandado')],
  ['posicionCliente', (h) => h.includes('posicion')],
  ['arbitro', (h) => h.includes('arbitro')],
  ['estado', (h) => h.includes('estado') && (h.includes('proceso') || h.includes('arbitraje'))],
  ['etapa', (h) => h.includes('estado') && h.includes('tarea')],
  ['prioridad', (h) => h === 'prioridad'],
  ['fechaInicio', (h) => h.includes('fecha') && h.includes('inicio')],
  ['ultimoMovimiento', (h) => h.includes('ultimo') && h.includes('movimiento') && !h.includes('fecha')],
  ['fechaUltimoMovimiento', (h) => h.includes('fecha') && h.includes('ultimo')],
  ['proximaActuacion', (h) => h.includes('proxima') && !h.includes('fecha')],
  ['fechaProximaActuacion', (h) => h.includes('fecha') && h.includes('proxima')],
  ['fechaLimite', (h) => h.includes('fecha') && h.includes('limite')],
  ['diasRestantes', (h) => h.includes('dias') && h.includes('rest')],
  ['semaforo', (h) => h === 'semaforo'],
  ['responsable', (h) => h.includes('responsable')],
  ['accionPendiente', (h) => h.includes('accion')],
  ['link', (h) => h.includes('link')],
  ['observaciones', (h) => h.includes('observacion')],
];

function parseProcesosSheet(sheet, tipo) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (h) => h.includes('id') && h.includes('caso'));
  if (headerIdx === -1) return [];
  const colFor = mapHeader(rows[headerIdx], PROCESO_RULES);

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const cliente = cell(row, colFor, 'cliente');
    if (!cliente) continue;
    const linkCol = colFor.link;
    const estado = cell(row, colFor, 'estado');
    out.push({
      tipo,
      idCaso: cell(row, colFor, 'idCaso'),
      cliente,
      sedeJuzgado: cell(row, colFor, 'sedeJuzgado'),
      especialidad: cell(row, colFor, 'especialidad'),
      tipoProceso: cell(row, colFor, 'tipoProceso'),
      codigo: cell(row, colFor, 'codigo'),
      numeroExpediente: cell(row, colFor, 'numeroExpediente'),
      partes: cell(row, colFor, 'partes'),
      demandante: cell(row, colFor, 'demandante'),
      demandado: cell(row, colFor, 'demandado'),
      posicionCliente: cell(row, colFor, 'posicionCliente'),
      arbitro: cell(row, colFor, 'arbitro'),
      estado,
      etapa: cell(row, colFor, 'etapa'),
      abierto: isCasoAbierto(estado),
      prioridad: cell(row, colFor, 'prioridad'),
      fechaInicio: cell(row, colFor, 'fechaInicio'),
      ultimoMovimiento: cell(row, colFor, 'ultimoMovimiento'),
      fechaUltimoMovimiento: cell(row, colFor, 'fechaUltimoMovimiento'),
      proximaActuacion: cell(row, colFor, 'proximaActuacion'),
      fechaProximaActuacion: cell(row, colFor, 'fechaProximaActuacion'),
      fechaLimite: cell(row, colFor, 'fechaLimite'),
      diasRestantes: cell(row, colFor, 'diasRestantes'),
      semaforo: cell(row, colFor, 'semaforo'),
      responsable: cell(row, colFor, 'responsable'),
      accionPendiente: cell(row, colFor, 'accionPendiente'),
      link: linkCol !== undefined ? String(row[linkCol] || '').trim() : '',
      linkUrl: linkCol !== undefined ? cellLink(sheet, r, linkCol) : null,
      observaciones: cell(row, colFor, 'observaciones'),
    });
  }
  return out;
}

// ---------- PENDIENTES (tareas) ----------
const TAREA_RULES = [
  ['id', (h) => h.includes('id') && h.includes('tarea')],
  ['fechaRegistro', (h) => h.includes('fecha') && h.includes('registro')],
  ['cliente', (h) => h === 'cliente'],
  ['idCaso', (h) => h.includes('id') && h.includes('caso')],
  ['tipoProceso', (h) => h.includes('tipo') && (h.includes('proceso') || h.includes('porceso'))],
  ['expediente', (h) => h === 'expediente'],
  ['tarea', (h) => h.includes('tarea') || h.includes('accion')],
  ['responsable', (h) => h === 'responsable'],
  ['prioridad', (h) => h === 'prioridad'],
  ['fechaLimite', (h) => h.includes('fecha') && h.includes('limite')],
  ['diasRestantes', (h) => h.includes('dias') && h.includes('rest')],
  ['semaforo', (h) => h === 'semaforo'],
  ['estado', (h) => h === 'estado'],
  ['fechaFinalizacion', (h) => h.includes('fecha') && h.includes('finalizacion')],
  ['observaciones', (h) => h.includes('observacion')],
  ['link', (h) => h.includes('link') || h.includes('documento')],
];

function parseTareasSheet(sheet) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (h) => h.includes('id') && h.includes('tarea'));
  if (headerIdx === -1) return [];
  const colFor = mapHeader(rows[headerIdx], TAREA_RULES);

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const tarea = cell(row, colFor, 'tarea');
    const cliente = cell(row, colFor, 'cliente');
    if (!tarea && !cliente) continue;
    const estado = cell(row, colFor, 'estado');
    out.push({
      id: cell(row, colFor, 'id'),
      fechaRegistro: cell(row, colFor, 'fechaRegistro'),
      cliente,
      idCaso: cell(row, colFor, 'idCaso'),
      tipoProceso: cell(row, colFor, 'tipoProceso'),
      expediente: cell(row, colFor, 'expediente'),
      tarea,
      responsable: cell(row, colFor, 'responsable'),
      prioridad: cell(row, colFor, 'prioridad'),
      fechaLimite: cell(row, colFor, 'fechaLimite'),
      diasRestantes: cell(row, colFor, 'diasRestantes'),
      semaforo: cell(row, colFor, 'semaforo'),
      estado,
      categoria: categorizeEstado(estado),
      fechaFinalizacion: cell(row, colFor, 'fechaFinalizacion'),
      observaciones: cell(row, colFor, 'observaciones'),
      link: cell(row, colFor, 'link'),
    });
  }
  return out;
}

// ---------- REUNIONES ----------
const REUNION_RULES = [
  ['id', (h) => h.includes('id') && h.includes('reunion')],
  ['cliente', (h) => h === 'cliente'],
  ['asunto', (h) => h.includes('expediente') || h.includes('asunto')],
  ['fecha', (h) => h === 'fecha'],
  ['hora', (h) => h === 'hora'],
  ['modalidad', (h) => h === 'modalidad'],
  ['link', (h) => h.includes('link')],
  ['responsable', (h) => h === 'responsable'],
  ['estado', (h) => h === 'estado'],
  ['observaciones', (h) => h.includes('observacion')],
];

function parseReunionesSheet(sheet) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (h) => h.includes('id') && h.includes('reunion'));
  if (headerIdx === -1) return [];
  const colFor = mapHeader(rows[headerIdx], REUNION_RULES);

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const cliente = cell(row, colFor, 'cliente');
    const fecha = cell(row, colFor, 'fecha');
    if (!cliente && !fecha) continue;
    out.push({
      id: cell(row, colFor, 'id'),
      cliente,
      asunto: cell(row, colFor, 'asunto'),
      fecha,
      hora: cell(row, colFor, 'hora'),
      modalidad: cell(row, colFor, 'modalidad'),
      link: cell(row, colFor, 'link'),
      responsable: cell(row, colFor, 'responsable'),
      estado: cell(row, colFor, 'estado'),
      observaciones: cell(row, colFor, 'observaciones'),
    });
  }
  return out;
}

async function fetchArbitrajeData() {
  const fileId = getFileId();
  const workbook = await downloadWorkbook(fileId);

  const clientesRaw = parseClientesSheet(workbook.Sheets['CLIENTES']);
  const procesosJudiciales = parseProcesosSheet(workbook.Sheets['PROCESOS JUDICIALES'], 'judicial');
  const procesosArbitrales = parseProcesosSheet(workbook.Sheets['PROCESOS ARBITRALES'], 'arbitral');
  const tareas = parseTareasSheet(workbook.Sheets['PENDIENTES']);
  const reuniones = parseReunionesSheet(workbook.Sheets['REUNIONES']);

  const todosLosProcesos = [...procesosJudiciales, ...procesosArbitrales];
  const totalExpedientesActivos = todosLosProcesos.filter((p) => p.abierto).length;
  const totalExpedientesCerrados = todosLosProcesos.length - totalExpedientesActivos;

  // Some clients' cases only ever show up as a PENDIENTES row (no dedicated
  // PROCESOS entry) — e.g. "OTROS CASOS" in the CLIENTES tab. Count both so
  // a client's "open" total actually matches what CLIENTES reports, instead
  // of only reflecting judicial/arbitral processes.
  const clientes = clientesRaw.map((c) => {
    const misProcesos = todosLosProcesos.filter((p) => p.cliente === c.nombre);
    const misTareas = tareas.filter((t) => t.cliente === c.nombre);
    const casosAbiertos =
      misProcesos.filter((p) => p.abierto).length + misTareas.filter((t) => t.categoria !== 'completo').length;
    return { ...c, casosAbiertos };
  });

  return {
    clientes,
    procesosJudiciales,
    procesosArbitrales,
    tareas,
    reuniones,
    totalExpedientesActivos,
    totalExpedientesCerrados,
    fetchedAt: new Date().toISOString(),
  };
}

async function getArbitrajeData({ forceRefresh } = {}) {
  const store = getPanelStore('panel');
  let cached = null;
  try {
    cached = await store.get(CACHE_KEY, { type: 'json' });
  } catch {
    cached = null;
  }

  const isFresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS;
  if (isFresh && !forceRefresh) return { ...cached, stale: false };

  try {
    const fresh = await fetchArbitrajeData();
    await store.setJSON(CACHE_KEY, fresh);
    return { ...fresh, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true, staleError: err.message };
    throw err;
  }
}

module.exports = { getArbitrajeData, categorizeEstado };
