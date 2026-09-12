const { requireSession, jsonResponse } = require('./utils/panel-auth');
const { getArbitrajeData } = require('./utils/sheet-arbitraje');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const session = requireSession(event);
  if (!session) return jsonResponse(401, { error: 'No autenticado.' });

  const forceRefresh = (event.queryStringParameters || {}).refresh === '1';

  try {
    const data = await getArbitrajeData({ forceRefresh });
    return jsonResponse(200, data);
  } catch (err) {
    return jsonResponse(502, { error: err.message || 'No se pudo sincronizar con la hoja de cálculo.' });
  }
};
