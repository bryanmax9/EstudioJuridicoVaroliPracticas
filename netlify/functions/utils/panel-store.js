const { getStore } = require('@netlify/blobs');

function store() {
  return getStore('panel');
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

module.exports = { readList, writeList, nextId };
