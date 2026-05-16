const { google } = require('googleapis');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { Readable } = require('stream');

const NAVY   = rgb(27 / 255, 45 / 255, 79 / 255);
const GOLD   = rgb(201 / 255, 160 / 255, 104 / 255);
const WHITE  = rgb(1, 1, 1);
const GRAY_D = rgb(0.15, 0.15, 0.15);
const GRAY_M = rgb(0.45, 0.45, 0.45);
const GRAY_L = rgb(0.72, 0.72, 0.72);

function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildCoverPDF({ nombre, apellidos, email, universidad, ciclo, area, mensaje }) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  const margin = 48;
  const contentW = width - margin * 2;

  // ── Header block ──────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 118, width, height: 118, color: NAVY });
  page.drawRectangle({ x: 0, y: height - 122, width, height: 4,   color: GOLD });

  page.drawText('ESTUDIO JURÍDICO VAROLI ABOGADOS', {
    x: margin, y: height - 52, size: 15, font: bold, color: WHITE,
  });
  page.drawText('POSTULACIÓN A PRÁCTICAS PREPROFESIONALES', {
    x: margin, y: height - 75, size: 9, font: reg, color: GOLD,
  });

  const fechaStr = new Date().toLocaleDateString('es-PE', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  page.drawText(`Fecha de postulación: ${fechaStr}`, {
    x: margin, y: height - 103, size: 7.5, font: reg, color: GRAY_L,
  });

  // ── Applicant data section ─────────────────────────────────────
  let y = height - 162;

  page.drawText('DATOS DEL POSTULANTE', {
    x: margin, y, size: 10.5, font: bold, color: NAVY,
  });
  page.drawLine({ start: { x: margin, y: y - 6 }, end: { x: width - margin, y: y - 6 }, thickness: 1, color: GOLD });

  y -= 30;

  const fields = [
    ['Nombre completo',   `${nombre} ${apellidos}`],
    ['Correo electrónico', email],
    ['Universidad',        universidad || '—'],
    ['Ciclo académico',    ciclo       || '—'],
    ['Área de interés',    area        || '—'],
  ];

  const labelX = margin;
  const valueX = margin + 170;

  for (const [label, value] of fields) {
    page.drawText(`${label}:`, {
      x: labelX, y, size: 8.5, font: bold, color: GRAY_M,
    });
    page.drawText(value, {
      x: valueX, y, size: 8.5, font: reg, color: GRAY_D,
    });
    y -= 22;
  }

  // ── Message section ────────────────────────────────────────────
  if (mensaje && mensaje.trim()) {
    y -= 14;
    page.drawText('MENSAJE DEL POSTULANTE', {
      x: margin, y, size: 10.5, font: bold, color: NAVY,
    });
    page.drawLine({ start: { x: margin, y: y - 6 }, end: { x: width - margin, y: y - 6 }, thickness: 1, color: GOLD });

    y -= 28;

    const msgLines = wrapText(mensaje.trim(), reg, 8.5, contentW);
    for (const line of msgLines) {
      if (y < 80) break;
      page.drawText(line, { x: margin, y, size: 8.5, font: reg, color: GRAY_D });
      y -= 15;
    }
  }

  // ── Footer bar ────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height: 38, color: NAVY });
  page.drawText(
    'Av. José Leal N° 835, Of. 302  ·  Lince – Lima, Perú  ·  consultasvaroli@gmail.com  ·  +51 924 333 108',
    { x: margin, y: 13, size: 6.5, font: reg, color: GRAY_L }
  );

  return doc.save();
}

async function mergePDFs(coverBytes, cvBytes) {
  const merged   = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(coverBytes);
  const cvDoc    = await PDFDocument.load(cvBytes);

  const coverPages = await merged.copyPages(coverDoc, coverDoc.getPageIndices());
  coverPages.forEach(p => merged.addPage(p));

  const cvPages = await merged.copyPages(cvDoc, cvDoc.getPageIndices());
  cvPages.forEach(p => merged.addPage(p));

  return merged.save();
}

async function uploadToDrive(pdfBytes, fileName) {
  const clientId     = process.env.GOOGLE_CLIENT_ID     || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || '';
  console.log('[drive] client_id ends:', clientId.slice(-10));
  console.log('[drive] secret ends:',   clientSecret.slice(-6));
  console.log('[drive] token ends:',    refreshToken.slice(-10));
  console.log('[drive] folder_id:',     process.env.GOOGLE_DRIVE_FOLDER_ID);

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground'
  );

  oauth2.setCredentials({ refresh_token: refreshToken });

  const drive    = google.drive({ version: 'v3', auth: oauth2 });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const stream = new Readable();
  stream.push(Buffer.from(pdfBytes));
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name:     fileName,
      mimeType: 'application/pdf',
      parents:  [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id, name',
  });

  return res.data;
}

// Allowed origins — add your production domain once deployed
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 6 MB hard cap on the full request body (base64 PDF ≈ 4 MB file)
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  const origin = event.headers['origin'] || event.headers['referer'] || '';
  const originAllowed =
    ALLOWED_ORIGINS.length === 0 ||
    ALLOWED_ORIGINS.some(o => origin.startsWith(o));

  const cors = {
    'Access-Control-Allow-Origin':  originAllowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  if (!originAllowed) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  // Reject oversized payloads before parsing
  const rawLen = Buffer.byteLength(event.body || '', 'utf8');
  if (rawLen > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'El archivo supera el tamaño máximo permitido (4 MB).' }),
    };
  }

  // Require JSON content-type
  const ct = (event.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return {
      statusCode: 415,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Content-Type must be application/json.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { nombre, apellidos, email, universidad, ciclo, area, mensaje, cvBase64 } = body;

    // Required field presence + format checks
    if (!nombre || !apellidos || !email) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Faltan campos requeridos.' }),
      };
    }
    if (!EMAIL_RE.test(email)) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El correo electrónico no es válido.' }),
      };
    }
    // Field length caps to prevent oversized PDF / injection attempts
    if (
      nombre.length     > 80  ||
      apellidos.length  > 80  ||
      email.length      > 120 ||
      (universidad || '').length > 120 ||
      (mensaje     || '').length > 2000
    ) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Uno o más campos superan el límite de caracteres.' }),
      };
    }

    // Build the form cover PDF
    const coverBytes = await buildCoverPDF({ nombre, apellidos, email, universidad, ciclo, area, mensaje });

    // Merge cover + CV (CV must be a valid PDF)
    let finalBytes = coverBytes;
    if (cvBase64) {
      try {
        const cvBytes = Buffer.from(cvBase64, 'base64');
        finalBytes = await mergePDFs(coverBytes, cvBytes);
      } catch {
        // CV could not be merged (corrupted or non-PDF); upload cover-only
        finalBytes = coverBytes;
      }
    }

    // Upload to Google Drive
    const safe = `${nombre}_${apellidos}`.replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `CV_${safe}_${date}.pdf`;

    await uploadToDrive(finalBytes, fileName);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('[submit-cv]', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error al procesar la solicitud. Intente nuevamente.' }),
    };
  }
};
