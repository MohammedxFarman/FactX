import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '../server/security.js';

const credentialsPath = 'data/portal-preview/logins.json';
const accounts = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const passwords = Object.fromEntries(['HOD', 'FACULTY', 'STUDENT'].map(role => [role, randomBytes(18).toString('base64url')]));
const db = new DatabaseSync('data/portal-preview/factx.sqlite');
try {
  db.exec('BEGIN IMMEDIATE');
  for (const account of accounts) {
    const user = db.prepare('SELECT id,role FROM users WHERE email=?').get(account.email);
    if (!user || user.role !== account.role || !passwords[account.role]) throw new Error('Preview account does not match the expected role.');
    account.password = passwords[account.role];
    db.prepare('UPDATE users SET password_hash=?,active=1 WHERE id=?').run(hashPassword(account.password),user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(randomUUID(),null,'preview.password_reset','users',user.id,JSON.stringify({reason:'User requested working preview portal access'}),new Date().toISOString());
  }
  db.exec('COMMIT');
  writeFileSync(credentialsPath, JSON.stringify(accounts,null,2), {mode:0o600});
  console.log('Reset the three preview passwords and revoked their old sessions. Main workspace untouched.');
} catch (error) {
  if (db.isTransaction) db.exec('ROLLBACK');
  throw error;
} finally {db.close();}
