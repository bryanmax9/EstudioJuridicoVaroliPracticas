const { requireSession } = require('./utils/panel-auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const session = requireSession(event);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(
      session
        ? { authenticated: true, email: session.sub, role: session.role, id: session.uid, nombre: session.nombre }
        : { authenticated: false }
    ),
  };
};
