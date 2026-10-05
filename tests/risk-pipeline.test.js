import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { featureRows } from '../server/risk-features.js';
import { importRiskPredictions, studentRisk } from '../server/risk-models.js';

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'factx-risk-'));
  const app = createApp({ dataDir: directory });
  const { db } = app;
  const department = randomUUID(), classId = randomUUID(), subject = randomUUID(), faculty = randomUUID(), student = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO departments VALUES(?,?,?)').run(department, 'Risk Department', 'RISK-' + department.slice(0, 6));
  db.prepare('INSERT INTO classes VALUES(?,?,?,?,?,?,?)').run(classId, 'Risk Class', department, 'BSc', '2026', 1, 'A');
  db.prepare('INSERT INTO subjects VALUES(?,?,?,?)').run(subject, 'Risk Subject', 'RS-' + subject.slice(0, 6), department);
  for (const [id, role, name, email, departmentId, classIdValue, roll] of [[faculty, 'FACULTY', 'Risk Faculty', 'faculty@risk.invalid', department, null, null], [student, 'STUDENT', 'Risk Student', 'student@risk.invalid', department, classId, 'RISK-001']]) {
    db.prepare('INSERT INTO users(id,name,email,password_hash,role,department_id,class_id,roll_number,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, email, 'test', role, departmentId, classIdValue, roll, timestamp);
  }
  db.prepare('INSERT INTO teaching_assignments VALUES(?,?,?,?)').run(randomUUID(), faculty, classId, subject);
  return { app, db, directory, department, classId, subject, student };
}

function artifact({ student, subject = null, target = 'attendance_shortage', version = 'risk-test-v1', now = new Date() }) {
  const observed = new Date(now.getTime() - 86400000).toISOString();
  const trained = new Date(now.getTime() - 10 * 86400000).toISOString();
  const reviewed = new Date(now.getTime() - 2 * 86400000).toISOString();
  const feature = 'attendance_percent';
  const model = {
    schema_version: 2, version, target, horizon_days: 30, selected_algorithm: 'random_forest', trained_at: trained,
    reviewed_at: reviewed, reviewed_by: 'Named institutional reviewer', dataset_reference: 'approved-risk-fixture',
    artifact_sha256: 'a'.repeat(64), metrics: { future_test: { average_precision: 0.62 } }, features: [feature],
    thresholds: { review: 0.4, high: 0.75 }, max_age_days: 30, min_coverage: 0.5, validated: true,
  };
  return { model, algorithm: 'random_forest', predictions: [{ student_id: student, subject_id: subject, probability: 0.8, category: 'high', factors: [{ feature, value: 65, contribution: 0.3, direction: 'increases estimated risk' }], observed_at: observed, created_at: observed, coverage: 1, missing_features: [], evidence_reason: '', feature_values: { [feature]: 65 } }] };
}

test('feature export is cutoff-aware and reviewed risk imports are idempotent', () => {
  const fixtureData = fixture();
  try {
    const student = fixtureData.db.prepare('SELECT * FROM users WHERE id=?').get(fixtureData.student);
    const at = new Date(Date.now() - 86400000);
    const rows = featureRows(fixtureData.db, [student], { target: 'attendance_shortage', at });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].observed_at, at.toISOString());
    assert.equal(rows[0].attendance_percent, null);
    const predictionArtifact = artifact({ student: fixtureData.student });
    const result = importRiskPredictions(fixtureData.db, predictionArtifact, 'risk-test-v1');
    assert.equal(result.inserted, 1);
    assert.equal(studentRisk(fixtureData.db, fixtureData.student).predictions[0].category, 'high');
    const repeated = importRiskPredictions(fixtureData.db, predictionArtifact, 'risk-test-v1');
    assert.equal(repeated.unchanged, 1);
    assert.equal(fixtureData.db.prepare('SELECT COUNT(*) n FROM risk_snapshots').get().n, 1);
  } finally { fixtureData.db.close(); rmSync(fixtureData.directory, { recursive: true, force: true }); }
});

test('subject risk outcomes require a subject-scoped prediction', () => {
  const fixtureData = fixture();
  try {
    const invalid = artifact({ student: fixtureData.student, target: 'course_failure' });
    assert.throws(() => importRiskPredictions(fixtureData.db, invalid, invalid.model.version), /requires a subject_id/);
    const valid = artifact({ student: fixtureData.student, subject: fixtureData.subject, target: 'course_failure', version: 'risk-subject-v1' });
    assert.equal(importRiskPredictions(fixtureData.db, valid, valid.model.version).inserted, 1);
  } finally { fixtureData.db.close(); rmSync(fixtureData.directory, { recursive: true, force: true }); }
});

test('latest risk snapshot follows the actual instant across timezone offsets', () => {
  const data = fixture();
  try {
    const at = new Date('2026-10-03T12:00:00Z');
    const older = artifact({ student: data.student, now: at });
    Object.assign(older.predictions[0], { observed_at: '2026-10-03T13:00:00+05:30', created_at: '2026-10-03T13:00:00+05:30' });
    importRiskPredictions(data.db, older, older.model.version, { at });
    const newer = structuredClone(older);
    Object.assign(newer.predictions[0], { observed_at: '2026-10-03T09:00:00Z', created_at: '2026-10-03T09:00:00Z', probability: .2, category: 'low' });
    importRiskPredictions(data.db, newer, newer.model.version, { at });
    assert.equal(studentRisk(data.db, data.student, at).predictions[0].category, 'low');
    const duplicate = structuredClone(newer);
    duplicate.predictions.push({ ...duplicate.predictions[0], observed_at: '2026-10-03T14:30:00+05:30' });
    assert.throws(() => importRiskPredictions(data.db, duplicate, duplicate.model.version, { at }), /duplicate/);
  } finally { data.db.close(); rmSync(data.directory, { recursive: true, force: true }); }
});
