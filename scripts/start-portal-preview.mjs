import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { startWorkflowReminders } from '../server/coordination.js';

// Explicitly isolated preview: never use FACTX_DATA_DIR or the main workspace.
const dataDir = path.resolve('data/portal-preview');
const credentialsPath = path.join(dataDir, 'logins.json');
process.env.COOKIE_SECURE = 'false';
const setupToken = randomBytes(24).toString('hex');
const { app, db, sendReminders } = createApp({ dataDir, setupToken });
startWorkflowReminders(sendReminders);
const server = await new Promise((resolve, reject) => {
  const instance = app.listen(3002, '127.0.0.1', () => resolve(instance));
  instance.once('error', reject);
});
const base = 'http://127.0.0.1:3002/api';
async function request(route, { body, cookie, method = 'POST' } = {}) {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${data.error || response.status}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

try {
  let accounts;
  if (existsSync(credentialsPath)) accounts = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  else {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('Preview already has users but no saved logins. Existing passwords were not changed.');
    const admin = await request('/auth/setup', { body: { name: 'Preview Administrator', email: 'preview-admin@factx.test', password: randomBytes(24).toString('base64url'), token: setupToken } });
    const create = async (route, body) => (await request(route, { body, cookie: admin.cookie })).data;
    await request('/preferences', { method:'PUT', cookie:admin.cookie, body:{institutionName:'FactX Portal Preview'} });
    const department = await create('/departments', { name:'Preview Computer Science', code:'PREVIEW-CS' });
    const classroom = await create('/classes', { name:'Preview Class', department_id:department.id, program:'Portal preview', batch:'Preview', semester:1, section:'A' });
    const subject = await create('/subjects', { name:'Preview Subject', code:'PREVIEW-101', department_id:department.id });
    accounts = [];
    for (const role of ['HOD','FACULTY','STUDENT']) {
      const account = { role, email:`${role.toLowerCase()}@factx.test`, password:randomBytes(12).toString('base64url') };
      const created = await create('/users', { ...account, name:`Preview ${role}`, department_id:department.id,
        ...(role === 'STUDENT' ? { class_id:classroom.id, roll_number:'PREVIEW-001' } : {}) });
      if (role === 'FACULTY') await create('/teaching-assignments', { faculty_id:created.id, class_id:classroom.id, subject_id:subject.id });
      accounts.push(account);
    }
    await request('/auth/logout', { cookie:admin.cookie });
    writeFileSync(credentialsPath, JSON.stringify(accounts, null, 2), { flag:'wx', mode:0o600 });
  }
  for (const account of accounts) {
    const login = await request('/auth/login', { body:{email:account.email,password:account.password} });
    if (login.data.role !== account.role) throw new Error('Unexpected account role.');
    await request('/dashboard', { method:'GET', cookie:login.cookie });
    await request('/auth/logout', { cookie:login.cookie });
  }
  // localhost keeps preview session cookies separate from the main 127.0.0.1 workspace.
  console.log('Preview portal: http://localhost:3002');
  console.log(JSON.stringify(accounts, null, 2));
  console.log('All three logins and dashboards verified. Main workspace data was not changed.');
} catch (error) {
  await new Promise(resolve => server.close(resolve));
  db.close();
  throw error;
}
