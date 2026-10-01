"""Validated, leakage-aware input contract for FactX risk models.

Training data contains features at a prediction cutoff and a separately
observed future outcome. This module never creates labels from support rules.
"""
import pandas as pd

TARGETS = {
    "course_failure": "A defined subject or semester failure outcome within the horizon.",
    "attendance_shortage": "Attendance falling below the institution's approved outcome definition within the horizon.",
    "assignment_delay": "A future late or missed assignment outcome within the horizon.",
    "lab_failure": "A defined lab assessment failure outcome within the horizon.",
}
BASE_FEATURES = ["attendance_percent", "assessment_average", "assignment_completion", "lab_average", "engagement_rate", "trailing_score_change"]
TREND_FEATURES = ["recent_attendance_percent", "attendance_change", "late_submission_percent", "lab_completion", "prior_result_average", "assessments_observed", "attendance_sessions_observed", "remaining_sessions"]
FEATURES = BASE_FEATURES + TREND_FEATURES
PERCENT_FEATURES = {"attendance_percent", "assessment_average", "assignment_completion", "lab_average", "engagement_rate", "recent_attendance_percent", "attendance_change", "late_submission_percent", "lab_completion", "prior_result_average"}
CHANGE_FEATURES = {"attendance_change", "trailing_score_change"}


def load_dataset(filename, training=True, target=None):
    frame = pd.read_csv(filename)
    required = ["student_id", "observed_at", *BASE_FEATURES] + (["outcome", "outcome_observed_at"] if training else [])
    missing = sorted(set(required) - set(frame.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    if frame["student_id"].isna().any():
        raise ValueError("student_id must not be missing.")
    frame["observed_at"] = pd.to_datetime(frame["observed_at"], utc=True, errors="raise")
    for feature in FEATURES:
        if feature not in frame:
            frame[feature] = pd.NA
        frame[feature] = pd.to_numeric(frame[feature], errors="coerce")
        if frame[feature].notna().sum() == 0 and feature in BASE_FEATURES:
            raise ValueError(f"Feature {feature} has no observed values. Supply real records or omit it consistently.")
        if feature in PERCENT_FEATURES or feature in CHANGE_FEATURES:
            lower, upper = (-100, 100) if feature in CHANGE_FEATURES else (0, 100)
            if not frame[feature].dropna().between(lower, upper).all():
                raise ValueError(f"Feature {feature} must be within [{lower}, {upper}].")
    if training:
        if target not in TARGETS:
            raise ValueError(f"Choose an explicit target from {sorted(TARGETS)}.")
        frame["outcome_observed_at"] = pd.to_datetime(frame["outcome_observed_at"], utc=True, errors="raise")
        if (frame["outcome_observed_at"] <= frame["observed_at"]).any():
            raise ValueError("outcome_observed_at must be after observed_at; future labels cannot leak into features.")
        if not frame["outcome"].isin([0, 1]).all():
            raise ValueError("outcome must be a validated binary future outcome, never a heuristic support label.")
        if len(frame) < 100 or frame.student_id.nunique() < 50 or frame.outcome.value_counts().min() < 20:
            raise ValueError("Insufficient labeled data: minimum 100 observations, 50 students and 20 observations of each outcome. These safeguards do not prove model quality.")
    return frame
