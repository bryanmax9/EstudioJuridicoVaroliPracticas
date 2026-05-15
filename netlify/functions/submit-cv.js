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
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

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

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { nombre, apellidos, email, universidad, ciclo, area, mensaje, cvBase64 } = body;

    if (!nombre || !apellidos || !email) {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Faltan campos requeridos.' }),
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
