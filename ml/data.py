"""Validated feature contract. No synthetic data or training-time demo fallback."""
import pandas as pd

FEATURES = ["attendance_percent", "assessment_average", "assignment_completion", "lab_average", "engagement_rate", "trailing_score_change"]

def load_dataset(filename, training=True):
    frame = pd.read_csv(filename)
    required = ["student_id", "observed_at", *FEATURES] + (["outcome"] if training else [])
    missing = set(required) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    if frame["student_id"].isna().any():
        raise ValueError("Student IDs must not be missing.")
    frame["observed_at"] = pd.to_datetime(frame["observed_at"], utc=True, errors="raise")
    for feature in FEATURES:
        frame[feature] = pd.to_numeric(frame[feature], errors="raise")
        if frame[feature].notna().sum() == 0:
            raise ValueError(f"Feature {feature} has no observed values.")
        bounds = (-100, 100) if feature == "trailing_score_change" else (0, 100)
        if not frame[feature].dropna().between(*bounds).all():
            raise ValueError(f"Feature {feature} must be within {bounds}.")
    if training:
        if not frame["outcome"].isin([0, 1]).all():
            raise ValueError("outcome must be a validated binary academic outcome, not a heuristic label.")
        if len(frame) < 100 or frame.student_id.nunique() < 50 or frame.outcome.value_counts().min() < 20 or frame.outcome.nunique() != 2:
            raise ValueError("Insufficient labeled data: minimum 100 observations, 50 students and 20 observations of each outcome. These are initial safeguards, not a guarantee of model quality.")
    return frame
