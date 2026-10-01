import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const password = 'Timetable-integration-password-937';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function service() {
  const server = createServer(async (_request, response) => {
    for await (const _chunk of _request) { /* consume the request before responding */ }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: JSON.stringify({ rows: [{ class: 'Timetable Class', subject: 'Timetable Subject', faculty: 'Timetable Faculty', day_of_week: 1, start_time: '09:00', end_time: '10:00', room: 'Room A', source_text: 'Monday 09:00–10:00' }] }) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('timetable assistant creates reviewed drafts and commits idempotently', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'factx-timetable-'));
  const ai = await service();
  const previous = Object.fromEntries(['OLLAMA_URL', 'OLLAMA_EMBED_MODEL', 'OLLAMA_CHAT_MODEL', 'OLLAMA_VISION_MODEL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { OLLAMA_URL: ai.url, OLLAMA_EMBED_MODEL: 'embed', OLLAMA_CHAT_MODEL: 'chat', OLLAMA_VISION_MODEL: 'vision' });
  const app = createApp({ dataDir: directory, setupToken: 'timetable-setup-token' });
  const server = await new Promise(resolve => { const value = app.app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, { body, cookie, method = 'GET' } = {}) => {
    const response = await fetch(base + '/api' + url, { method, headers: { ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const post = async (url, body, cookie) => { const response = await request(url, { method: 'POST', body, cookie }); assert.ok(response.status < 300, JSON.stringify(response)); return response.data; };
  try {
    const setup = await request('/auth/setup', { method: 'POST', body: { name: 'Timetable Admin', email: 'timetable-admin@test.invalid', password, token: 'timetable-setup-token' } });
    assert.equal(setup.status, 201);
    const admin = setup.cookie;
    const department = await post('/departments', { name: 'Timetable Department', code: 'TT-' + Date.now() }, admin);
    const classRecord = await post('/classes', { name: 'Timetable Class', department_id: department.id, semester: 1 }, admin);
    const subject = await post('/subjects', { name: 'Timetable Subject', code: 'TTS-' + Date.now(), department_id: department.id }, admin);
    const faculty = await post('/users', { name: 'Timetable Faculty', email: 'timetable-faculty@test.invalid', password, role: 'FACULTY', department_id: department.id }, admin);
    await post('/teaching-assignments', { faculty_id: faculty.id, class_id: classRecord.id, subject_id: subject.id }, admin);
    const login = await request('/auth/login', { method: 'POST', body: { email: 'timetable-faculty@test.invalid', password } });
    const facultyCookie = login.cookie;
    const status = await request('/assistant/timetable/status', { cookie: facultyCookie });
    assert.equal(status.status, 200);
    assert.equal(status.data.visionConfigured, true);
    const form = new FormData();
    form.append('instruction', 'Read the uploaded timetable and prepare a draft.');
    form.append('file', new Blob([png], { type: 'image/png' }), 'timetable.png');
    const draftResponse = await request('/assistant/timetable/drafts', { method: 'POST', body: form, cookie: facultyCookie });
    assert.equal(draftResponse.status, 201, JSON.stringify(draftResponse.data));
    assert.equal(draftResponse.data.canCommit, true);
    assert.equal(draftResponse.data.rows[0].class_id, classRecord.id);
    const committed = await request('/assistant/timetable/drafts/' + draftResponse.data.id + '/commit', { method: 'POST', cookie: facultyCookie, body: { confirm: true, revision: draftResponse.data.revision } });
    assert.equal(committed.status, 200, JSON.stringify(committed.data));
    assert.equal(committed.data.status, 'committed');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 1);
    const retry = await request('/assistant/timetable/drafts/' + draftResponse.data.id + '/commit', { method: 'POST', cookie: facultyCookie, body: { confirm: true, revision: committed.data.revision } });
    assert.equal(retry.status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 1);
    const student = await post('/users', { name: 'Timetable Student', email: 'timetable-student@test.invalid', password, role: 'STUDENT', department_id: department.id, class_id: classRecord.id, roll_number: 'TT-001' }, admin);
    const studentLogin = await request('/auth/login', { method: 'POST', body: { email: 'timetable-student@test.invalid', password } });
    assert.equal((await request('/assistant/timetable/status', { cookie: studentLogin.cookie })).status, 403);
    assert.equal(student.id.length > 0, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.db.close();
    await ai.close();
    rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
