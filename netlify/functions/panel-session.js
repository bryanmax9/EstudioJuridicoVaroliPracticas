const { verifySessionToken, parseCookies, COOKIE_NAME } = require('./utils/panel-auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const sessionSecret = process.env.PANEL_SESSION_SECRET || '';
  const cookies = parseCookies(event.headers['cookie'] || event.headers['Cookie'] || '');
  const token = cookies[COOKIE_NAME];
  const payload = sessionSecret ? verifySessionToken(token, sessionSecret) : null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(
      payload ? { authenticated: true, email: payload.sub } : { authenticated: false }
    ),
  };
};
