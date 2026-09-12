// Live read-only sync from the "Templo 2- Clientes" Google Drive workbook
// (an .xlsx file, not a native Google Sheet) into the panel's Arbitraje view.
//
// Requires GOOGLE_SERVICE_ACCOUNT_KEY (same service account already used for
// Drive uploads elsewhere in this repo) to have been granted Viewer access to
// the workbook by its owner, since it's a binary Office file the Sheets API
// can't read directly — we pull the raw bytes via Drive and parse them here.

const { google } = require('googleapis');
const XLSX = require('xlsx');
const { getPanelStore } = require('./panel-store');

const DEFAULT_FILE_ID = '1EwQ5TjPc2JpKn2Q0IRS3Kx6NqcLBFUJe'; // "Templo 2- Clientes"
const CACHE_KEY = 'arbitraje-sheet-cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

const SKIP_TABS = new Set(['INICIO', 'PROCESOS JUDICIALES', 'PRACTICANTES', 'INSTRUCCIONES']);
const SPECIAL_TABS = new Set(['ARBITRAJES', 'AGENDA', 'OTROS CLIENTES']);

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
        'con la cuenta de servicio configurada en GOOGLE_SERVICE_ACCOUNT_KEY.'
      );
    }
    throw err;
  }
  return XLSX.read(Buffer.from(res.data), { type: 'buffer', cellText: true });
}

function sheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function cellLink(sheet, r, c) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = sheet[ref];
  return cell && cell.l && cell.l.Target ? cell.l.Target : null;
}

// Confirmed with the person who maintains the workbook: each row in a
// client's tab is one expediente/proceso (not a loose task) — a client can
// have several open in parallel. ESTADO is the case status; ACCIÓN is a
// separate "next step" column (HACER/REVISAR/RECORDAR) that isn't part of
// open/closed logic. Only COMPLETADO/LISTO count as closed; everything else
// (including a case whose ESTADO is literally "URGENTE") is open.
const CLOSED_ESTADOS = ['completado', 'listo'];

function isEstadoAbierto(estado) {
  const norm = normalize(estado);
  if (!norm) return true;
  return !CLOSED_ESTADOS.includes(norm);
}

function findHeaderRow(rows, matchesFirstCol, matchesSecondCol) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const a = normalize(row[0]);
    const b = normalize(row[1]);
    if (matchesFirstCol(a) && (!matchesSecondCol || matchesSecondCol(b))) return i;
  }
  return -1;
}

// Column header → canonical field, matched by normalized substring.
const PENDIENTE_HEADER_RULES = [
  ['numero', (h) => h === 'n' || h === 'no'],
  ['cliente', (h) => h === 'cliente'],
  ['fechaSolicitud', (h) => h.includes('fecha') && h.includes('solicitud')],
  ['descripcion', (h) => h.includes('descripcion') && h.includes('servicio')],
  ['hechos', (h) => h === 'hechos'],
  ['procedimiento', (h) => h.includes('procedimiento')],
  ['accion', (h) => h === 'accion'],
  ['fechaActual', (h) => h.includes('fecha') && h.includes('actual')],
  ['fechaLimite', (h) => h.includes('fecha') && h.includes('limite')],
  ['diasRestantes', (h) => h.includes('dias') && h.includes('rest')],
  ['horario', (h) => h === 'horario'],
  ['estado', (h) => h === 'estado'],
  ['prioridad', (h) => h === 'prioridad'],
  ['link', (h) => h.includes('link') || h.includes('expediente')],
  ['observaciones', (h) => h.includes('observacion')],
];

function parsePendientesSheet(sheet, clienteFallback) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (a) => a === 'n' || a === 'no');
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(normalize);
  const colFor = {};
  header.forEach((h, i) => {
    if (!h) return;
    const rule = PENDIENTE_HEADER_RULES.find(([, test]) => test(h));
    if (rule && colFor[rule[0]] === undefined) colFor[rule[0]] = i;
  });

  const pendientes = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;

    const descripcion = colFor.descripcion !== undefined ? String(row[colFor.descripcion] || '').trim() : '';
    if (!descripcion || /sin pendientes registrados/i.test(descripcion)) continue;

    const linkCol = colFor.link;
    const estado = colFor.estado !== undefined ? String(row[colFor.estado] || '').trim() : '';
    pendientes.push({
      numero: colFor.numero !== undefined ? String(row[colFor.numero] || '').trim() : '',
      cliente: colFor.cliente !== undefined ? String(row[colFor.cliente] || '').trim() : clienteFallback,
      fechaSolicitud: colFor.fechaSolicitud !== undefined ? String(row[colFor.fechaSolicitud] || '').trim() : '',
      descripcion,
      hechos: colFor.hechos !== undefined ? String(row[colFor.hechos] || '').trim() : '',
      procedimiento: colFor.procedimiento !== undefined ? String(row[colFor.procedimiento] || '').trim() : '',
      accion: colFor.accion !== undefined ? String(row[colFor.accion] || '').trim() : '',
      fechaActual: colFor.fechaActual !== undefined ? String(row[colFor.fechaActual] || '').trim() : '',
      fechaLimite: colFor.fechaLimite !== undefined ? String(row[colFor.fechaLimite] || '').trim() : '',
      diasRestantes: colFor.diasRestantes !== undefined ? String(row[colFor.diasRestantes] || '').trim() : '',
      horario: colFor.horario !== undefined ? String(row[colFor.horario] || '').trim() : '',
      estado,
      abierto: isEstadoAbierto(estado),
      prioridad: colFor.prioridad !== undefined ? String(row[colFor.prioridad] || '').trim() : '',
      link: linkCol !== undefined ? String(row[linkCol] || '').trim() : '',
      linkUrl: linkCol !== undefined ? cellLink(sheet, r, linkCol) : null,
      observaciones: colFor.observaciones !== undefined ? String(row[colFor.observaciones] || '').trim() : '',
    });
  }
  return pendientes;
}

function parseArbitrajesSheet(sheet) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (a) => a === 'cliente', (b) => b.includes('expediente'));
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(normalize);
  const idx = (test) => header.findIndex(test);
  const col = {
    cliente: idx((h) => h === 'cliente'),
    expediente: idx((h) => h.includes('expediente')),
    demandante: idx((h) => h.includes('demandante')),
    demandado: idx((h) => h.includes('demandado')),
    tipo: idx((h) => h.includes('tipo') && h.includes('arbitraje')),
    estadoActual: idx((h) => h.includes('estado') && h.includes('proceso')),
    proximoHito: idx((h) => h.includes('proximo') || h.includes('hito') || h.includes('accion')),
    responsable: idx((h) => h.includes('responsable')),
  };

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;
    const cliente = col.cliente !== -1 ? String(row[col.cliente] || '').trim() : '';
    if (!cliente) continue;
    out.push({
      cliente,
      expediente: col.expediente !== -1 ? String(row[col.expediente] || '').trim() : '',
      demandante: col.demandante !== -1 ? String(row[col.demandante] || '').trim() : '',
      demandado: col.demandado !== -1 ? String(row[col.demandado] || '').trim() : '',
      tipo: col.tipo !== -1 ? String(row[col.tipo] || '').trim() : '',
      estadoActual: col.estadoActual !== -1 ? String(row[col.estadoActual] || '').trim() : '',
      proximoHito: col.proximoHito !== -1 ? String(row[col.proximoHito] || '').trim() : '',
      responsable: col.responsable !== -1 ? String(row[col.responsable] || '').trim() : '',
    });
  }
  return out;
}

function parseAgendaSheet(sheet) {
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (a) => a === 'fecha', (b) => b.includes('hora'));
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(normalize);
  const idx = (test) => header.findIndex(test);
  const col = {
    fecha: idx((h) => h === 'fecha'),
    hora: idx((h) => h === 'hora'),
    cliente: idx((h) => h === 'cliente'),
    tipo: idx((h) => h === 'tipo'),
    descripcion: idx((h) => h.includes('descripcion')),
    lugar: idx((h) => h.includes('lugar') || h.includes('link')),
    responsable: idx((h) => h.includes('responsable')),
    estado: idx((h) => h === 'estado'),
  };

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;
    const fecha = col.fecha !== -1 ? String(row[col.fecha] || '').trim() : '';
    const cliente = col.cliente !== -1 ? String(row[col.cliente] || '').trim() : '';
    if (!fecha && !cliente) continue;
    out.push({
      fecha,
      hora: col.hora !== -1 ? String(row[col.hora] || '').trim() : '',
      cliente,
      tipo: col.tipo !== -1 ? String(row[col.tipo] || '').trim() : '',
      descripcion: col.descripcion !== -1 ? String(row[col.descripcion] || '').trim() : '',
      lugar: col.lugar !== -1 ? String(row[col.lugar] || '').trim() : '',
      responsable: col.responsable !== -1 ? String(row[col.responsable] || '').trim() : '',
      estado: col.estado !== -1 ? String(row[col.estado] || '').trim() : '',
    });
  }
  return out;
}

function parseInicioSheet(workbook) {
  const sheet = workbook.Sheets['INICIO'];
  if (!sheet) return [];
  const rows = sheetRows(sheet);
  const headerIdx = findHeaderRow(rows, (a) => a === 'letra');
  if (headerIdx === -1) return [];

  const clientes = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    const letra = String(row[0] || '').trim();
    const nombre = String(row[1] || '').trim();
    if (!letra || !nombre) continue;
    const irCell = String(row[4] || '');
    const sheetName = irCell.replace(/^.*▸\s*/, '').trim() || nombre;
    clientes.push({
      letra,
      nombre,
      pendientesCount: Number(row[2]) || 0,
      urgentes: Number(row[3]) || 0,
      sheetName,
    });
  }
  return clientes;
}

// The INICIO index's "Ver pestaña" label doesn't always match the real tab
// name byte-for-byte (e.g. "LA PROTECTORA / SABSA" vs. the actual tab
// "LA PROTECTORA - SABSA") — fall back to a normalized-name match.
function resolveSheetName(workbook, label) {
  if (workbook.Sheets[label]) return label;
  const target = normalize(label);
  const found = workbook.SheetNames.find((name) => normalize(name) === target);
  return found || label;
}

async function fetchArbitrajeData() {
  const fileId = getFileId();
  const workbook = await downloadWorkbook(fileId);

  // The INICIO tab's "N° pendientes"/"Urgentes" counts are maintained by hand
  // and drift out of sync with what's actually in each client's tab — derive
  // both live from the parsed rows instead, so counts always match what the
  // drill-down shows.
  const clientesIndex = parseInicioSheet(workbook);
  const clientes = clientesIndex.map((c) => {
    const sheetName = resolveSheetName(workbook, c.sheetName);
    const sheet = workbook.Sheets[sheetName];
    const pendientes = sheet ? parsePendientesSheet(sheet, c.nombre) : [];
    const urgentes = pendientes.filter((p) => /urgente/i.test(p.prioridad)).length;
    const expedientesActivos = pendientes.filter((p) => p.abierto).length;
    return {
      ...c,
      sheetName,
      pendientes,
      pendientesCount: pendientes.length,
      urgentes,
      expedientesActivos,
      expedientesCerrados: pendientes.length - expedientesActivos,
    };
  });

  const otrosSheet = workbook.Sheets['OTROS CLIENTES'];
  const otrosClientes = otrosSheet ? parsePendientesSheet(otrosSheet, 'Otros clientes') : [];

  const arbitrajesSheet = workbook.Sheets['ARBITRAJES'];
  const arbitrajes = arbitrajesSheet ? parseArbitrajesSheet(arbitrajesSheet) : [];

  const agendaSheet = workbook.Sheets['AGENDA'];
  const agenda = agendaSheet ? parseAgendaSheet(agendaSheet) : [];

  return {
    clientes,
    otrosClientes,
    arbitrajes,
    agenda,
    totalExpedientesActivos: clientes.reduce((s, c) => s + c.expedientesActivos, 0),
    totalExpedientesCerrados: clientes.reduce((s, c) => s + c.expedientesCerrados, 0),
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

module.exports = { getArbitrajeData };
