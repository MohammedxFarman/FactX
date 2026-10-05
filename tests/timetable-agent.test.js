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
    const route = '/assistant/timetable/drafts/' + draftResponse.data.id;
    assert.equal((await request(route, { cookie: admin })).status, 404, 'Drafts remain private to their owner');
    assert.equal((await request('/assistant/timetable/drafts', { cookie: facultyCookie })).data.length, 1);
    const duplicateRows = await request(route, { method: 'PATCH', cookie: facultyCookie, body: { rows: [...draftResponse.data.rows, ...draftResponse.data.rows], revision: 1 } });
    assert.equal(duplicateRows.status, 200);
    assert.ok(duplicateRows.data.issues.some(issue => issue.code === 'draft_conflict'));
    assert.equal((await request(route + '/commit', { method: 'POST', cookie: facultyCookie, body: { confirm: true, revision: 2 } })).status, 409);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 0, 'Invalid drafts must not partially write sessions');
    assert.equal((await request(route, { method: 'PATCH', cookie: facultyCookie, body: { rows: [], revision: 1 } })).status, 409, 'Stale edits must not overwrite newer corrections');
    const corrected = await request(route, { method: 'PATCH', cookie: facultyCookie, body: { rows: draftResponse.data.rows, revision: 2 } });
    assert.equal(corrected.data.canCommit, true);
    draftResponse.data = corrected.data;
    const committed = await request('/assistant/timetable/drafts/' + draftResponse.data.id + '/commit', { method: 'POST', cookie: facultyCookie, body: { confirm: true, revision: draftResponse.data.revision } });
    assert.equal(committed.status, 200, JSON.stringify(committed.data));
    assert.equal(committed.data.status, 'committed');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 1);
    const retry = await request('/assistant/timetable/drafts/' + draftResponse.data.id + '/commit', { method: 'POST', cookie: facultyCookie, body: { confirm: true, revision: committed.data.revision } });
    assert.equal(retry.status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 1);
    assert.equal((await request(route, { method: 'PATCH', cookie: facultyCookie, body: { rows: [], revision: committed.data.revision } })).status, 409);
    // Separate faculty/class ensure that only the room can cause this conflict.
    const otherClass = await post('/classes', { name: 'Other Timetable Class', department_id: department.id, semester: 1 }, admin);
    const otherFaculty = await post('/users', { name: 'Other Timetable Faculty', email: 'timetable-other@test.invalid', password, role: 'FACULTY', department_id: department.id }, admin);
    await post('/teaching-assignments', { faculty_id: otherFaculty.id, class_id: otherClass.id, subject_id: subject.id }, admin);
    app.db.prepare('UPDATE timetable SET room=?').run(' Room   A ');
    const session = { class_id: otherClass.id, faculty_id: otherFaculty.id, subject_id: subject.id, day_of_week: 1, start_time: '09:30', end_time: '10:30', room: 'room a' };
    assert.equal((await request('/timetable', { method: 'POST', cookie: admin, body: session })).status, 409, 'Manual entries normalize room spacing and case');
    const adminDraft = await post('/assistant/timetable/drafts', form, admin);
    const roomConflict = await request('/assistant/timetable/drafts/' + adminDraft.id, { method: 'PATCH', cookie: admin, body: { revision: adminDraft.revision, rows: [session] } });
    assert.ok(roomConflict.data.issues.some(issue => issue.code === 'conflict'), 'Imports detect the same room conflict');
    assert.equal((await request('/assistant/timetable/drafts/' + adminDraft.id + '/commit', { method: 'POST', cookie: admin, body: { confirm: true, revision: roomConflict.data.revision } })).status, 409);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM timetable').get().n, 1);
    assert.equal((await request('/timetable', { method: 'POST', cookie: admin, body: { ...session, start_time: '10:00', end_time: '11:00' } })).status, 201, 'Adjacent sessions can share a room');
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
