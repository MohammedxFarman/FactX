import { z } from 'zod';
import { ensureRiskSchema } from './risk-models.js';
import { RISK_TARGETS, featureRows, FEATURE_LIMITATIONS } from './risk-features.js';

const csv = value => {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
};

export function registerRisk({ app, db, roles }) {
  ensureRiskSchema(db);
  const query = z.object({
    target: z.enum(RISK_TARGETS).default('attendance_shortage'),
    horizon_days: z.coerce.number().int().min(1).max(365).default(30),
    observed_at: z.string().datetime({ offset: true }).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  });

  app.get('/api/risk/features', roles('ADMIN', 'HOD'), (req, res) => {
    const input = query.parse(req.query);
    const at = input.observed_at ? new Date(input.observed_at) : new Date();
    if (at > new Date(Date.now() + 60_000)) throw Object.assign(new Error('Feature cutoff cannot be in the future.'), { status: 400 });
    const rows = featureRows(db, req.scope.students(), { target: input.target, horizonDays: input.horizon_days, at });
    if (input.format === 'csv') {
      const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
      res.type('text/csv').send([columns.map(csv).join(','), ...rows.map(row => columns.map(column => csv(row[column])).join(','))].join('\n'));
      return;
    }
    res.json({ target: input.target, horizon_days: input.horizon_days, observed_at: at.toISOString(), features: rows.length ? Object.keys(rows[0]).filter(key => !['student_id', 'subject_id', 'department_id', 'class_id', 'cohort', 'observed_at', 'feature_cutoff_at', 'target', 'horizon_days'].includes(key)) : [], rows, limitations: FEATURE_LIMITATIONS });
  });

  app.get('/api/risk/monitoring', roles('ADMIN', 'HOD'), (req, res) => {
    const students = new Set(req.scope.students().map(student => student.id));
    const models = db.prepare('SELECT m.version,m.algorithm,m.trained_at,m.active,c.target,c.horizon_days,c.max_age_days,c.min_coverage FROM model_versions m JOIN risk_model_contracts c ON c.model_id=m.id WHERE m.validated=1 ORDER BY c.target,c.horizon_days,m.trained_at DESC').all();
    const scoped = db.prepare('SELECT r.*,u.department_id,c.batch FROM risk_snapshots r JOIN users u ON u.id=r.student_id LEFT JOIN classes c ON c.id=u.class_id').all().filter(row => students.has(row.student_id));
    const groups = {};
    for (const row of scoped) {
      const key = `${row.department_id || 'unassigned'}:${row.batch || 'unassigned'}`;
      groups[key] ??= { department_id: row.department_id, cohort: row.batch, total: 0, available: 0, abstentions: 0, categories: { low: 0, medium: 0, high: 0, insufficient_evidence: 0 } };
      const group = groups[key]; group.total++;
      if (row.probability === null || row.category === 'insufficient_evidence') group.abstentions++; else { group.available++; group.categories[row.category] = (group.categories[row.category] || 0) + 1; }
    }
    res.json({ models, scope: { students: students.size, snapshots: scoped.length }, groups: Object.values(groups), limitations: ['Monitoring describes stored reviewed snapshots; it is not an accuracy guarantee.', 'Groups with small counts require institutional review before comparison.'] });
  });
}
