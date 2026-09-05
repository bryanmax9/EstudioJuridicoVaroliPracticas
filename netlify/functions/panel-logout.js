const { buildClearCookie } = require('./utils/panel-auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildClearCookie() },
    body: JSON.stringify({ success: true }),
  };
};
