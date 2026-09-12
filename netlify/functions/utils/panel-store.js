const { getStore } = require('@netlify/blobs');

// Automatic credential injection for Netlify Blobs only reliably kicks in for
// "Functions v2" — this repo's functions use the classic v1 `exports.handler`
// signature, so `getStore(name)` alone throws "environment has not been
// configured..." in production. Fall back to explicit siteID/token (as the
// error message itself suggests) when they're set; keep automatic mode as
// the default so this still works if the functions are ever migrated to v2.
function getPanelStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

function store() {
  return getPanelStore('panel');
}

async function readList(key) {
  const data = await store().get(key, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function writeList(key, list) {
  await store().setJSON(key, list);
}

function nextId(list) {
  const max = list.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0);
  return max + 1;
}

module.exports = { readList, writeList, nextId, getPanelStore };
