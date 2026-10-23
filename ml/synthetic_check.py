"""Reproducible synthetic-only training experiment; never activates application models.

Run: python ml/synthetic_check.py
Generated datasets, models and reports stay in the ignored data/ directory.
The simulated outcomes are invented, not independently observed student outcomes.
Metrics measure recovery of these invented patterns, not institutional accuracy.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from data import FEATURES, TARGETS, load_dataset
from predict import generate_predictions


def synthetic_students(rows, seed):
    rng = np.random.default_rng(seed)
    engagement, skill, pressure = rng.normal(size=(3, rows))
    def percent(center, signal, noise=8):
        return np.round(np.clip(center + signal + rng.normal(0, noise, rows), 0, 100), 2)

    attendance = percent(78, 12 * engagement - 7 * pressure)
    recent = percent(76, 13 * engagement - 9 * pressure)
    frame = pd.DataFrame({
        'student_id': [f'SYNTHETIC-{seed}-{i:05d}' for i in range(rows)],
        'subject_id': 'SYNTHETIC-SUBJECT',
        'synthetic': True,
        'observed_at': [pd.Timestamp('2022-01-01', tz='UTC') + pd.Timedelta(days=i + (60 if i >= int(rows * .8) else 0)) for i in range(rows)],
        'attendance_percent': attendance,
        'assessment_average': percent(65, 15 * skill + 7 * engagement - 5 * pressure),
        'assignment_completion': percent(78, 13 * engagement - 10 * pressure),
        'lab_average': percent(65, 16 * skill + 5 * engagement - 6 * pressure),
        'engagement_rate': percent(65, 17 * engagement - 6 * pressure),
        'trailing_score_change': np.round(np.clip(4 * engagement - 5 * pressure + rng.normal(0, 5, rows), -100, 100), 2),
        'recent_attendance_percent': recent,
        'attendance_change': np.round(recent - attendance, 2),
        'late_submission_percent': percent(25, -10 * engagement + 12 * pressure),
        'lab_completion': percent(75, 10 * engagement + 5 * skill - 8 * pressure),
        'prior_result_average': percent(65, 16 * skill),
        'assessments_observed': rng.integers(3, 20, rows),
        'attendance_sessions_observed': rng.integers(20, 100, rows),
        'remaining_sessions': rng.integers(10, 40, rows),
    })
    # Invented latent-factor mechanisms with future randomness, not support-rule labels.
    signals = {
        'course_failure': -.9 - 1.5 * skill - .65 * engagement + .65 * pressure,
        'attendance_shortage': -1.0 - 1.7 * engagement + 1.0 * pressure,
        'assignment_delay': -.9 - 1.4 * engagement + 1.2 * pressure,
        'lab_failure': -.9 - 1.6 * skill - .6 * engagement + .7 * pressure,
    }
    outcomes = {}
    for target, signal in signals.items():
        probability = 1 / (1 + np.exp(-(signal + rng.normal(0, .6, rows))))
        outcomes[target] = rng.binomial(1, probability)
    return frame, outcomes


def run(output, rows=1200, seed=42):
    output.mkdir(parents=True, exist_ok=False)
    frame, outcomes = synthetic_students(rows, seed)
    fresh, _ = synthetic_students(12, seed + 1)
    fresh['observed_at'] = pd.Timestamp.now(tz='UTC')
    # A matched pair tests scoring changed records without training on those records.
    fresh.loc[1, FEATURES] = fresh.loc[0, FEATURES].to_numpy()
    fresh.loc[0, ['attendance_percent', 'recent_attendance_percent', 'assignment_completion', 'engagement_rate']] = [94, 95, 95, 92]
    fresh.loc[0, ['assessment_average', 'lab_average', 'prior_result_average', 'lab_completion']] = [88, 90, 86, 95]
    fresh.loc[0, ['attendance_change', 'trailing_score_change', 'late_submission_percent']] = [1, 5, 3]
    fresh.loc[1, ['attendance_percent', 'recent_attendance_percent', 'assignment_completion', 'engagement_rate']] = [52, 40, 40, 35]
    fresh.loc[1, ['assessment_average', 'lab_average', 'prior_result_average', 'lab_completion']] = [38, 35, 45, 40]
    fresh.loc[1, ['attendance_change', 'trailing_score_change', 'late_submission_percent']] = [-12, -15, 65]
    fresh.loc[10, FEATURES[:2]] = np.nan
    fresh.loc[11, FEATURES] = np.nan
    fresh.to_csv(output / 'synthetic-prediction-input.csv', index=False)
    prediction_frame = load_dataset(output / 'synthetic-prediction-input.csv', training=False)
    results = {'synthetic_only': True, 'seed': seed, 'students_per_target': rows,
               'limitation': 'Invented data and simulated future outcomes. These metrics do not establish real-student accuracy. No application model is reviewed or activated.',
               'targets': {}}
    for target in sorted(TARGETS):
        dataset = frame.copy()
        dataset['outcome'] = outcomes[target]
        dataset['outcome_observed_at'] = dataset.observed_at + pd.Timedelta(days=30)
        filename = output / f'synthetic-{target}.csv'
        dataset.to_csv(filename, index=False)
        checked = load_dataset(filename, target=target)
        cutoff = checked.observed_at.quantile(.8)
        development, holdout = checked[checked.observed_at < cutoff], checked[checked.observed_at >= cutoff]
        assert set(development.student_id).isdisjoint(holdout.student_id)
        assert development.outcome_observed_at.max() < holdout.observed_at.min()
        version = f'synthetic-{target}-seed-{seed}'
        print(f'Training {target}: {len(development)} development / {len(holdout)} future holdout students', flush=True)
        subprocess.run([sys.executable, str(Path(__file__).with_name('train.py')), str(filename),
                        '--version', version, '--dataset-reference', f'SYNTHETIC-ONLY-seed-{seed}',
                        '--target', target, '--horizon-days', '30', '--output', str(output / 'models')], check=True)
        directory = output / 'models' / version
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
        assert manifest['validated'] is False and manifest['active'] is False
        model = joblib.load(directory / f"{manifest['selected_algorithm']}.joblib")
        predictions = generate_predictions(model, prediction_frame, manifest)
        assert len(predictions) == len(prediction_frame)
        assert [row['student_id'] for row in predictions] == fresh.student_id.tolist()
        assert all(p['probability'] is not None and 0 <= p['probability'] <= 1 for p in predictions[:-1])
        assert predictions[-1]['probability'] is None and predictions[-1]['category'] == 'insufficient_evidence'
        assert predictions[0]['probability'] != predictions[1]['probability']
        updated = prediction_frame.iloc[[0]].copy()
        updated.loc[updated.index[0], FEATURES] = prediction_frame.iloc[1][FEATURES].to_numpy()
        rescored = generate_predictions(model, updated, manifest)[0]
        assert rescored['student_id'] == predictions[0]['student_id']
        assert np.isclose(rescored['probability'], predictions[1]['probability'])
        # Deliberately not an importable reviewed-model artifact.
        (output / f'synthetic-{target}-predictions.json').write_text(json.dumps({
            'synthetic_only': True, 'active': False, 'validated': False,
            'target': target, 'predictions': predictions}, indent=2), encoding='utf-8')
        candidates = manifest['metrics']['candidates']
        for metrics in candidates.values():
            matrix = np.asarray(metrics['future_test']['confusion_matrix'])
            metrics['future_test']['accuracy'] = float(np.trace(matrix) / matrix.sum())
        target_result = {
            'selected_algorithm': manifest['selected_algorithm'],
            'calibrated': hasattr(model, 'calibrated_classifiers_'),
            'development_rows': len(development), 'holdout_rows': len(holdout),
            'candidates': candidates,
            'prior_only_baseline_brier': float(np.mean((holdout.outcome.to_numpy() - development.outcome.mean()) ** 2)),
            'majority_baseline_accuracy': float(np.mean(holdout.outcome.to_numpy() == int(development.outcome.mean() >= .5))),
            'paired_inputs': {'stronger_records_probability': predictions[0]['probability'],
                              'weaker_records_probability': predictions[1]['probability']},
            'prediction_checks': '11 scored (including partial missing data); 1 abstained; changed inputs change the score; student identities preserved',
        }
        results['targets'][target] = target_result
        print(json.dumps({'target': target, 'selected': manifest['selected_algorithm'],
                          'calibrated': target_result['calibrated'],
                          'holdout': candidates[manifest['selected_algorithm']]['future_test']}), flush=True)
        (output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    lines = ['# FactX synthetic ML experiment', '', results['limitation'], '',
             f'Seed: {seed}. Students per outcome: {rows}. Split: 80% development, 20% later holdout, distinct students and a 60-day gap.', '',
             'Model choice uses development grouped cross-validation; the holdout does not choose the winner.', '',
             '| Outcome | Selected algorithm | ROC-AUC | PR-AUC | Accuracy | Precision | Recall | Brier |',
             '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for target, result in results['targets'].items():
        metrics = result['candidates'][result['selected_algorithm']]['future_test']
        values = ' | '.join(f'{metrics[key]:.3f}' for key in ['roc_auc', 'average_precision', 'accuracy', 'precision', 'recall', 'brier_score'])
        lines.append(f"| {target} | {result['selected_algorithm']} | {values} |")
    lines += ['', 'PR-AUC baseline is holdout prevalence (see results.json). Brier: lower is better.',
              'Prediction checks passed on fresh synthetic inputs, including changed records and missing-data abstention.',
              'This explicitly calls the prediction function in a test harness; it does not enable automatic web-app inference.',
              'All manifests remain unvalidated and inactive. Datasets and model binaries are local generated files.']
    (output / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Completed synthetic-only experiment: {output / "REPORT.md"}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('data') / ('synthetic-risk-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')))
    parser.add_argument('--rows', type=int, default=1200)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.rows < 500:
        parser.error('Use at least 500 synthetic students for this experiment.')
    run(args.output, args.rows, args.seed)
