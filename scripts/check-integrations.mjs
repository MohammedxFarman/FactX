import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

if (process.env.FACTX_ENV_FILE) loadEnvFile(process.env.FACTX_ENV_FILE);
else if (existsSync('.env')) loadEnvFile('.env');
const results = [];
const report = (name, status, detail) => results.push({ name, status, detail });
const get = async (base, route, headers = {}) => {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) endpoint without credentials in the URL.');
  }
  const response = await fetch(base.replace(/\/$/, '') + route, {
    headers, signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Service returned HTTP ${response.status}.`);
  return response.json();
};

report('Frontend', existsSync('dist/index.html') ? 'READY' : 'MISSING',
  existsSync('dist/index.html') ? 'Production bundle exists; npm run build refreshes it.' : 'Run npm run build.');

let installedModels;
async function checkModels(name, keys, readyDetail) {
  const missing = ['OLLAMA_URL', ...keys].filter(key => !process.env[key]);
  if (missing.length) {
    report(name, 'MISSING', `Set ${missing.join(', ')} in .env. Record lookup and saved draft review remain available.`);
    return;
  }
  try {
    installedModels ??= get(process.env.OLLAMA_URL, '/api/tags', process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}).then(data => {
      if (!Array.isArray(data.models) || !data.models.every(model => model && typeof (model.name || model.model) === 'string')) {
        throw new Error('Service returned an invalid model list.');
      }
      return data.models;
    });
    const normalize = value => value.includes(':') ? value : `${value}:latest`;
    const installed = new Set((await installedModels).map(model => normalize(model.name || model.model)));
    const absent = keys.filter(key => !installed.has(normalize(process.env[key])));
    report(name, absent.length ? 'MISSING' : 'READY', absent.length
      ? `Configured model is not installed for ${absent.join(', ')}.`
      : readyDetail);
  } catch (error) { report(name, 'ERROR', error instanceof TypeError ? 'Cannot reach the service; check URL, network and credentials.' : error.message); }
}
await checkModels('Document AI', ['OLLAMA_EMBED_MODEL', 'OLLAMA_CHAT_MODEL'],
  'Service reachable and both models listed. Index documents and verify a cited answer before use.');
await checkModels('Timetable agent', ['OLLAMA_CHAT_MODEL', 'OLLAMA_VISION_MODEL'],
  'Service reachable and chat/vision models listed. Verify text PDF and image extraction with a reviewed timetable.');

if (!process.env.JUDGE_URL) report('Code execution', 'MISSING', 'Set JUDGE_URL for a separately hosted Judge0 service; optionally set JUDGE_TOKEN.');
else {
  try {
    const languages = await get(process.env.JUDGE_URL, '/languages', process.env.JUDGE_TOKEN ? { 'X-Auth-Token': process.env.JUDGE_TOKEN } : {});
    if (!Array.isArray(languages) || !languages.every(item => Number.isInteger(item.id) && typeof item.name === 'string')) throw new Error('Service returned an invalid language list.');
    const supported = [/^Python \(3/, /^JavaScript \(Node/, /^C \(GCC/, /^C\+\+ \(GCC/, /^Java \(/];
    const count = supported.filter(pattern => languages.some(language => pattern.test(language.name))).length;
    report('Code execution', count === supported.length ? 'READY' : 'MISSING', `${count}/5 application languages available. Live execution and sandbox isolation still require validation.`);
  } catch (error) { report('Code execution', 'ERROR', error instanceof TypeError ? 'Cannot reach the service; check URL, network and credentials.' : error.message); }
}

const databasePath = path.resolve(process.env.FACTX_DATA_DIR || 'data', 'factx.sqlite');
if (!existsSync(databasePath)) report('Risk model', 'MISSING', 'No application database yet. Start the app; train and review a model using ml/README.md.');
else {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const model = db.prepare('SELECT version FROM model_versions WHERE active=1 AND validated=1').get();
    report('Risk model', model ? 'READY' : 'MISSING', model ? `Reviewed active version: ${model.version}` : 'No reviewed model is active. An approved dataset and named model review are required.');
  } catch { report('Risk model', 'ERROR', 'Could not inspect model status in the existing database.'); }
  finally { db?.close(); }
}
for (const { name, status, detail } of results) console.log(`${status.padEnd(7)} ${name}: ${detail}`);
console.log('\nThis check does not submit code, generate AI answers, train models, or change application records.');
if (results.some(result => result.status === 'ERROR') || (process.argv.includes('--strict') && results.some(result => result.status !== 'READY'))) process.exitCode = 1;
