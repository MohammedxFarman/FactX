import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RISK_TARGETS, RISK_FEATURES, SUBJECT_TARGETS } from './risk-features.js';

const dateTime = z.string().datetime({ offset: true });
const finite = z.number().finite();
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
export const ALGORITHMS = ['random_forest', 'logistic_regression', 'hist_gradient_boosting'];
const factor = z.object({ feature: z.string().min(1), value: finite.nullable(), contribution: finite, direction: z.string().min(1) }).passthrough();
const manifestSchema = z.object({
  schema_version: z.literal(2), version: z.string().min(1).max(120), target: z.enum(RISK_TARGETS), horizon_days: z.number().int().min(1).max(365),
  validated: z.literal(true), reviewed_by: z.string().trim().min(1).max(300), reviewed_at: dateTime, trained_at: dateTime,
  dataset_reference: z.string().min(1).max(500), metrics: z.record(z.unknown()), features: z.array(z.enum(RISK_FEATURES)).min(1).max(RISK_FEATURES.length),
  selected_algorithm: z.enum(ALGORITHMS), thresholds: z.object({ review: finite.min(0).max(1), high: finite.min(0).max(1) }),
  max_age_days: z.number().int().min(1).max(90).default(30), min_coverage: finite.min(0).max(1).default(0.5),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/), model_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reference_stats: z.record(z.unknown()).default({}),
}).passthrough();
const predictionSchema = z.object({
  student_id: z.string().uuid(), subject_id: z.string().uuid().nullable().optional(), probability: finite.min(0).max(1).nullable(),
  category: z.enum(['low', 'medium', 'high', 'insufficient_evidence']), factors: z.array(factor).max(100), observed_at: dateTime, created_at: dateTime,
  coverage: finite.min(0).max(1), missing_features: z.array(z.string()).max(100).default([]), evidence_reason: z.string().max(2000).default(''),
  feature_values: z.record(finite.nullable()).optional(),
}).passthrough();
export const riskArtifactSchema = z.object({ model: manifestSchema, algorithm: z.enum(ALGORITHMS), predictions: z.array(predictionSchema).min(1).max(100000) });

export function ensureRiskSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_model_contracts(model_id TEXT PRIMARY KEY REFERENCES model_versions(id), target TEXT NOT NULL, horizon_days INTEGER NOT NULL, manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL, max_age_days INTEGER NOT NULL, min_coverage REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS risk_snapshots(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), subject_id TEXT REFERENCES subjects(id), model_id TEXT NOT NULL REFERENCES model_versions(id), category TEXT NOT NULL, probability REAL, factors TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, imported_at TEXT NOT NULL, coverage REAL NOT NULL, missing_features TEXT NOT NULL, evidence_reason TEXT NOT NULL, feature_values TEXT NOT NULL DEFAULT '{}', fingerprint TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS idx_risk_snapshots_student ON risk_snapshots(student_id,model_id,observed_at DESC,created_at DESC);
    CREATE TABLE IF NOT EXISTS risk_imports(id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES model_versions(id), artifact_hash TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL, inserted INTEGER NOT NULL, unchanged INTEGER NOT NULL);
  `);
}

export function importRiskPredictions(db, artifact, approvedVersion, { at = new Date() } = {}) {
  ensureRiskSchema(db);
  const parsed = riskArtifactSchema.parse(artifact), model = parsed.model;
  if (model.version !== approvedVersion) throw new Error('The named version does not match the reviewed artifact.');
  if (model.selected_algorithm !== parsed.algorithm) throw new Error('The artifact algorithm does not match the reviewed model.');
  if (model.thresholds.review >= model.thresholds.high) throw new Error('Risk thresholds must satisfy review < high.');
  if (new Set(model.features).size !== model.features.length) throw new Error('Feature names must be unique.');
  const current = at.getTime(), futureLimit = current + 300000;
  if (Date.parse(model.trained_at) > futureLimit || Date.parse(model.reviewed_at) > futureLimit || Date.parse(model.reviewed_at) < Date.parse(model.trained_at)) throw new Error('Model training and review timestamps are inconsistent.');
  const manifestText = canonical(model), manifestHash = hash(manifestText), artifactHash = hash(canonical(parsed));
  const existing = db.prepare('SELECT m.id,c.manifest_hash FROM model_versions m LEFT JOIN risk_model_contracts c ON c.model_id=m.id WHERE m.version=?').get(model.version);
  if (existing && existing.manifest_hash !== manifestHash) throw new Error('This version has different model metadata. Register changed models under a new version.');
  const seen = new Set();
  for (const row of parsed.predictions) {
    const student = db.prepare("SELECT * FROM users WHERE id=? AND role='STUDENT' AND active=1").get(row.student_id);
    if (!student) throw new Error('A prediction references an unknown or inactive student.');
    if (SUBJECT_TARGETS.has(model.target) && !row.subject_id) throw new Error('This outcome requires a subject_id.');
    if (row.subject_id && !db.prepare('SELECT id FROM subjects WHERE id=? AND department_id=?').get(row.subject_id, student.department_id)) throw new Error('Prediction subject must belong to the student department.');
    const key = `${row.student_id}:${row.subject_id || ''}:${row.observed_at}`;
    if (seen.has(key)) throw new Error('The artifact contains duplicate student/subject snapshots.');
    seen.add(key);
    const observed = Date.parse(row.observed_at), created = Date.parse(row.created_at);
    if (observed > futureLimit || created > futureLimit || created < observed || created < Date.parse(model.trained_at)) throw new Error('Prediction timestamps are inconsistent or in the future.');
    if (current - observed > model.max_age_days * 86400000) throw new Error('Prediction features are stale. Export a fresh snapshot before importing.');
    if (row.missing_features.some(feature => !model.features.includes(feature)) || new Set(row.missing_features).size !== row.missing_features.length) throw new Error('Missing feature names do not match the model contract.');
    const calculatedCoverage = 1 - row.missing_features.length / model.features.length;
    if (Math.abs(row.coverage - calculatedCoverage) > 0.000001) throw new Error('Prediction coverage does not match the missing feature list.');
    if (row.probability === null) {
      if (row.category !== 'insufficient_evidence' || !row.evidence_reason || row.factors.length) throw new Error('Abstentions require an explanation and cannot contain probability explanations.');
    } else {
      if (row.coverage < model.min_coverage) throw new Error('Insufficient feature coverage must produce an abstention.');
      const category = row.probability >= model.thresholds.high ? 'high' : row.probability >= model.thresholds.review ? 'medium' : 'low';
      if (row.category !== category) throw new Error('Prediction category does not match the reviewed thresholds.');
      if (!row.factors.length || row.factors.some(item => !model.features.includes(item.feature))) throw new Error('Prediction explanations must name model features.');
    }
  }
  const modelId = existing?.id || randomUUID();
  let inserted = 0, unchanged = 0;
  db.exec('BEGIN');
  try {
    if (!existing) {
      db.prepare('INSERT INTO model_versions VALUES(?,?,?,?,?,?,?,1,0)').run(modelId, model.version, parsed.algorithm, model.dataset_reference, JSON.stringify(model.metrics), JSON.stringify(model.features), model.trained_at);
      db.prepare('INSERT INTO risk_model_contracts VALUES(?,?,?,?,?,?,?)').run(modelId, model.target, model.horizon_days, manifestText, manifestHash, model.max_age_days, model.min_coverage);
    }
    db.prepare('UPDATE model_versions SET active=0 WHERE id IN (SELECT model_id FROM risk_model_contracts WHERE target=? AND horizon_days=?)').run(model.target, model.horizon_days);
    db.prepare('UPDATE model_versions SET active=1 WHERE id=?').run(modelId);
    for (const row of parsed.predictions) {
      const fingerprint = hash(canonical({ modelId, ...row }));
      const result = db.prepare('INSERT OR IGNORE INTO risk_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.student_id, row.subject_id || null, modelId, row.category, row.probability, JSON.stringify(row.factors), row.observed_at, row.created_at, at.toISOString(), row.coverage, JSON.stringify(row.missing_features), row.evidence_reason, JSON.stringify(row.feature_values || {}), fingerprint);
      if (result.changes) inserted++; else unchanged++;
    }
    db.prepare('INSERT OR IGNORE INTO risk_imports VALUES(?,?,?,?,?,?)').run(randomUUID(), modelId, artifactHash, at.toISOString(), inserted, unchanged);
    db.prepare('INSERT INTO audit_logs VALUES(?,NULL,?,?,?,?,?)').run(randomUUID(), existing ? 'model.predictions_refreshed' : 'model.activated', 'model_versions', modelId, JSON.stringify({ version: model.version, target: model.target, horizon_days: model.horizon_days, reviewed_by: model.reviewed_by, inserted, unchanged }), at.toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { version: model.version, target: model.target, horizon_days: model.horizon_days, inserted, unchanged };
}

export function studentRisk(db, studentId, at = new Date()) {
  const predictions = [], abstentions = [], models = db.prepare('SELECT m.*,c.target,c.horizon_days,c.max_age_days,c.min_coverage FROM model_versions m JOIN risk_model_contracts c ON c.model_id=m.id WHERE m.active=1 AND m.validated=1 ORDER BY c.target,c.horizon_days').all();
  for (const model of models) {
    const snapshots = db.prepare('SELECT r.*,s.name subject_name FROM risk_snapshots r LEFT JOIN subjects s ON s.id=r.subject_id WHERE r.student_id=? AND r.model_id=? ORDER BY r.observed_at DESC,r.created_at DESC,r.rowid DESC').all(studentId, model.id);
    const seen = new Set();
    if (!snapshots.length) abstentions.push({ target: model.target, horizon_days: model.horizon_days, model_version: model.version, status: 'missing', reason: 'No feature snapshot has been scored for this student.' });
    for (const row of snapshots) {
      const subject = row.subject_id || '';
      if (seen.has(subject)) continue;
      seen.add(subject);
      const base = { id: row.id, model_version: model.version, algorithm: model.algorithm, target: model.target, horizon_days: model.horizon_days, subject_id: row.subject_id, subject_name: row.subject_name, observed_at: row.observed_at, created_at: row.created_at, coverage: row.coverage, missing_features: JSON.parse(row.missing_features) };
      if (at.getTime() - Date.parse(row.observed_at) > model.max_age_days * 86400000) abstentions.push({ ...base, status: 'stale', reason: 'This feature snapshot is out of date. Refresh it before using the estimate.' });
      else if (row.probability === null || row.coverage < model.min_coverage) abstentions.push({ ...base, status: 'insufficient_evidence', reason: row.evidence_reason || 'There is not enough observed information to estimate this outcome.' });
      else predictions.push({ ...base, status: 'available', probability: row.probability, category: row.category, factors: JSON.parse(row.factors) });
    }
  }
  const rank = { high: 3, medium: 2, low: 1 };
  predictions.sort((a, b) => rank[b.category] - rank[a.category] || b.probability - a.probability);
  return { status: predictions.length ? 'available' : models.length ? 'insufficient_evidence' : 'not_configured', predictions, abstentions, active_models: models.length, coverage: predictions.length ? predictions.reduce((sum, row) => sum + row.coverage, 0) / predictions.length : null, limitations: ['Estimates support faculty review; they are not certain outcomes. Explanation factors describe model associations, not causes.'] };
}
