"""Regression checks using temporary, synthetic feature rows; no model activation."""
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd
import numpy as np
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml'))
from data import BASE_FEATURES, FEATURES, load_dataset
from predict import generate_predictions
from train import fit_calibrated
from models import candidates
from synthetic_check import synthetic_students


class DatasetTests(unittest.TestCase):
    def load(self, rows, **options):
        with tempfile.TemporaryDirectory(prefix='factx-ml-test-') as directory:
            filename = Path(directory) / 'features.csv'
            pd.DataFrame(rows).to_csv(filename, index=False)
            return load_dataset(filename, **options)

    def row(self, **changes):
        return {'student_id': 'test-student', 'observed_at': '2026-01-01T00:00:00Z',
                **dict.fromkeys(BASE_FEATURES, 70), **changes}

    def test_prediction_all_missing_measurements_reaches_abstention(self):
        frame = self.load([self.row(**dict.fromkeys(BASE_FEATURES, None))], training=False)
        self.assertTrue(frame[BASE_FEATURES].isna().all().all())
        model = Mock()
        predictions = generate_predictions(model, frame, {'features': FEATURES, 'target': 'attendance_shortage', 'min_coverage': .75})
        model.predict_proba.assert_not_called()
        self.assertEqual(predictions[0]['category'], 'insufficient_evidence')
        self.assertIsNone(predictions[0]['probability'])
        self.assertEqual(predictions[0]['coverage'], 0)
        self.assertEqual(predictions[0]['missing_features'], FEATURES)

    def test_only_sufficient_rows_are_scored_and_keep_student_identity(self):
        rows = [self.row(student_id='missing', **dict.fromkeys(BASE_FEATURES, None)),
                self.row(student_id='observed', **dict.fromkeys(FEATURES, 50))]
        frame = self.load(rows, training=False)
        model = Mock()
        model.predict_proba.return_value = np.array([[.2, .8]])
        manifest = {'features': FEATURES, 'target': 'attendance_shortage', 'min_coverage': .75, 'thresholds': {'review': .4, 'high': .75}}
        with patch('predict.explain', return_value=[{'feature': 'attendance_percent'}]):
            predictions = generate_predictions(model, frame, manifest)
        model.predict_proba.assert_called_once()
        self.assertEqual([(p['student_id'], p['category']) for p in predictions], [('missing', 'insufficient_evidence'), ('observed', 'high')])

    def test_subject_outcomes_reject_missing_subject_before_scoring(self):
        frame = self.load([self.row()], training=False)
        model = Mock()
        with self.assertRaisesRegex(ValueError, 'subject_id'):
            generate_predictions(model, frame, {'features': FEATURES, 'target': 'course_failure'})
        model.predict_proba.assert_not_called()

    def test_missing_cutoff_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'observed_at'):
            self.load([self.row(observed_at=None)], training=False)

    def test_invalid_numeric_data_is_not_silently_treated_as_missing(self):
        with self.assertRaises(ValueError):
            self.load([self.row(), self.row(attendance_percent='invalid')], training=False)

    def test_infinite_and_negative_counts_are_rejected(self):
        for value in [float('inf'), -1, .5]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load([self.row(assessments_observed=value)], training=False)

    def test_training_requires_both_outcomes(self):
        rows = [self.row(student_id=f'student-{i}', outcome=1, outcome_observed_at='2026-02-01T00:00:00Z') for i in range(100)]
        with self.assertRaisesRegex(ValueError, 'each outcome'):
            self.load(rows, target='attendance_shortage')

    def test_training_requires_observed_outcome_dates(self):
        rows = [self.row(student_id=f'student-{i}', outcome=i % 2, outcome_observed_at=None) for i in range(100)]
        with self.assertRaisesRegex(ValueError, 'outcome_observed_at'):
            self.load(rows, target='attendance_shortage')


class CalibrationTests(unittest.TestCase):
    def test_calibration_keeps_repeated_students_out_of_opposite_fold(self):
        frame, outcomes = synthetic_students(120, 42)
        groups = np.repeat(np.arange(60), 2)
        model = fit_calibrated(candidates()['logistic_regression'], frame[FEATURES], outcomes['assignment_delay'], groups)
        self.assertTrue(hasattr(model, 'calibrated_classifiers_'))
        for train, valid in model.cv:
            self.assertTrue(set(groups[train]).isdisjoint(groups[valid]))
        probabilities = model.predict_proba(frame[FEATURES])
        self.assertTrue(np.isfinite(probabilities).all())
        self.assertTrue(np.allclose(probabilities.sum(axis=1), 1))

    def test_unrelated_fit_errors_are_not_silently_swallowed(self):
        frame, outcomes = synthetic_students(120, 42)
        with patch('train.CalibratedClassifierCV.fit', side_effect=ValueError('broken estimator')):
            with self.assertRaisesRegex(ValueError, 'broken estimator'):
                fit_calibrated(candidates()['logistic_regression'], frame[FEATURES], outcomes['assignment_delay'], frame.student_id.to_numpy())


if __name__ == '__main__':
    unittest.main()
