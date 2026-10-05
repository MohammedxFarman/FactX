import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/check-integrations.mjs', import.meta.url));

test('integration readiness checks real model availability and all advertised languages', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'factx-readiness-'));
  mkdirSync(path.join(directory, 'dist'));
  writeFileSync(path.join(directory, 'dist/index.html'), '<!doctype html>');
  let models = ['chat:latest', 'embed:latest'], tagsRequests = 0;
  let languages = [{ id: 1, name: 'Python (3.12)' }];
  let unavailable = false;
  const service = createServer((request, response) => {
    if (unavailable) { response.writeHead(503); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      tagsRequests++;
      response.end(JSON.stringify({ models: models.map(name => ({ name })) }));
    } else response.end(JSON.stringify(languages));
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${service.address().port}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(OLLAMA_|JUDGE_|FACTX_)/.test(key)) delete env[key];
  const run = async (configuration = {}, flags = []) => {
    try {
      const result = await execute(process.execPath, [script, ...flags], { cwd: directory, env: { ...env, ...configuration }, timeout: 20000 });
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return error;
    }
  };
  const configured = { OLLAMA_URL: endpoint, OLLAMA_CHAT_MODEL: 'chat', OLLAMA_EMBED_MODEL: 'embed', OLLAMA_VISION_MODEL: 'vision', JUDGE_URL: endpoint };
  try {
    await t.test('missing configuration remains a blocker in strict mode', async () => {
      const result = await run({}, ['--strict']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /MISSING Document AI/);
      assert.match(result.stdout, /MISSING Timetable agent/);
      assert.match(result.stdout, /MISSING Code execution/);
      assert.match(result.stdout, /MISSING Risk model/);
    });
    await t.test('a configured but absent vision model is not ready', async () => {
      const result = await run(configured);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /READY\s+Document AI/);
      assert.match(result.stdout, /MISSING Timetable agent:.*OLLAMA_VISION_MODEL/);
      assert.match(result.stdout, /MISSING Code execution: 1\/5/);
      assert.equal(tagsRequests, 1, 'Both AI checks share one installed-model response');
    });
    await t.test('timetable availability does not depend on document embeddings', async () => {
      models = ['chat:latest', 'vision:latest'];
      const result = await run({ ...configured, OLLAMA_EMBED_MODEL: '' });
      assert.match(result.stdout, /MISSING Document AI/);
      assert.match(result.stdout, /READY\s+Timetable agent/);
    });
    await t.test('all services available still require a reviewed risk model', async () => {
      models = ['chat:latest', 'vision:latest', 'embed:latest'];
      languages = ['Python (3.12)', 'JavaScript (Node.js 22)', 'C (GCC 14)', 'C++ (GCC 14)', 'Java (OpenJDK 21)'].map((name, id) => ({ id, name }));
      const result = await run(configured, ['--strict']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /READY\s+Document AI/);
      assert.match(result.stdout, /READY\s+Timetable agent/);
      assert.match(result.stdout, /READY\s+Code execution: 5\/5/);
      assert.match(result.stdout, /MISSING Risk model/);
    });
    await t.test('unreachable services never report ready', async () => {
      unavailable = true;
      const result = await run(configured);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /ERROR\s+Document AI/);
      assert.match(result.stdout, /ERROR\s+Timetable agent/);
      assert.match(result.stdout, /ERROR\s+Code execution/);
    });
  } finally {
    await new Promise(resolve => service.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
