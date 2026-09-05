#!/usr/bin/env node
// Run locally with: node scripts/generate-panel-credentials.js
// Prints the environment variables to paste into Netlify (Site settings →
// Environment variables). Never commit the values it prints.
const crypto = require('crypto');
const readline = require('readline');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = rl._writeToOutput;
    rl._writeToOutput = (chunk) => {
      if (chunk.trim() && chunk.trim() !== question.trim()) return; // hide typed chars
      write.call(rl, chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const password = process.argv[2] || (await promptHidden('Contraseña para el panel (min. 10 caracteres): '));

  if (!password || password.length < 10) {
    console.error('\nLa contraseña debe tener al menos 10 caracteres.');
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const sessionSecret = crypto.randomBytes(32).toString('hex');

  console.log('\nAgrega estas variables en Netlify → Site settings → Environment variables:\n');
  console.log('PANEL_ADMIN_EMAIL=tu-correo@ejemplo.com');
  console.log(`PANEL_ADMIN_PASSWORD_HASH=${salt}:${hash}`);
  console.log(`PANEL_SESSION_SECRET=${sessionSecret}`);
  console.log('\nNo subas estos valores al repositorio ni los compartas por chat/email.');
})();
