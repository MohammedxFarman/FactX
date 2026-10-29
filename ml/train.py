"""Train and evaluate FactX candidates without auto-activating a model."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import average_precision_score, balanced_accuracy_score, brier_score_loss, confusion_matrix, f1_score, fbeta_score, log_loss, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold

from data import FEATURES, TARGETS, load_dataset
from models import candidates


def probability_metrics(y_true, probability, threshold):
    predicted = probability >= threshold
    return {"roc_auc": float(roc_auc_score(y_true, probability)), "average_precision": float(average_precision_score(y_true, probability)), "brier_score": float(brier_score_loss(y_true, probability)), "log_loss": float(log_loss(y_true, np.clip(probability, 1e-6, 1 - 1e-6))), "balanced_accuracy": float(balanced_accuracy_score(y_true, predicted)), "precision": float(precision_score(y_true, predicted, zero_division=0)), "recall": float(recall_score(y_true, predicted, zero_division=0)), "f1": float(f1_score(y_true, predicted, zero_division=0)), "f2": float(fbeta_score(y_true, predicted, beta=2, zero_division=0)), "confusion_matrix": confusion_matrix(y_true, predicted).tolist(), "prevalence": float(np.mean(y_true)), "alert_rate": float(np.mean(predicted)), "threshold": float(threshold)}


def bootstrap_ci(y_true, probability, seed=42, rounds=200):
    rng, values = np.random.default_rng(seed), []
    for _ in range(rounds):
        indexes = rng.integers(0, len(y_true), len(y_true))
        if len(np.unique(y_true[indexes])) < 2:
            continue
        values.append(average_precision_score(y_true[indexes], probability[indexes]))
    return {"average_precision_95ci": [float(np.quantile(values, .025)), float(np.quantile(values, .975))] if values else None}


def choose_threshold(y_true, probability, max_alert_rate=.35):
    best = (0.5, -1.0)
    for threshold in np.linspace(.05, .95, 181):
        predicted = probability >= threshold
        if predicted.mean() > max_alert_rate:
            continue
        score = fbeta_score(y_true, predicted, beta=2, zero_division=0)
        if score > best[1]:
            best = (float(threshold), float(score))
    return best[0]


def fit_calibrated(estimator, x, y, groups):
    folds = min(3, len(np.unique(groups)))
    if folds < 2:
        return estimator.fit(x, y)
    # Materialize group-aware indices: the calibration wrapper does not reliably
    # forward groups to its splitter. Do not silently swallow unrelated fit errors.
    splits = list(GroupKFold(n_splits=folds).split(x, y, groups=groups))
    if any(len(np.unique(y[train])) < 2 or len(np.unique(y[valid])) < 2 for train, valid in splits):
        return estimator.fit(x, y)
    model = CalibratedClassifierCV(estimator=estimator, method="sigmoid", cv=splits)
    model.fit(x, y)
    return model


def evaluate_candidates(development, test):
    x_dev, y_dev, groups = development[FEATURES], development.outcome.to_numpy(), development.student_id.to_numpy()
    x_test, y_test = test[FEATURES], test.outcome.to_numpy()
    folds = min(5, len(np.unique(groups)))
    if folds < 2:
        raise ValueError("At least two student groups are required for grouped validation.")
    splitter, results, fitted, out_of_fold = GroupKFold(n_splits=folds), {}, {}, {}
    for name, estimator in candidates().items():
        fold_metrics, oof_probability = [], np.full(len(y_dev), np.nan)
        for train_index, valid_index in splitter.split(x_dev, y_dev, groups=groups):
            model = fit_calibrated(clone(estimator), x_dev.iloc[train_index], y_dev[train_index], groups[train_index])
            probability = model.predict_proba(x_dev.iloc[valid_index])[:, 1]
            oof_probability[valid_index] = probability
            if len(np.unique(y_dev[valid_index])) == 2:
                fold_metrics.append({"average_precision": float(average_precision_score(y_dev[valid_index], probability)), "roc_auc": float(roc_auc_score(y_dev[valid_index], probability)), "brier_score": float(brier_score_loss(y_dev[valid_index], probability))})
        calibrated = fit_calibrated(clone(estimator), x_dev, y_dev, groups)
        development_probability = oof_probability if not np.isnan(oof_probability).any() else calibrated.predict_proba(x_dev)[:, 1]
        threshold = choose_threshold(y_dev, development_probability)
        test_probability = calibrated.predict_proba(x_test)[:, 1]
        results[name] = {"cv": {key: float(np.mean([row[key] for row in fold_metrics])) for key in fold_metrics[0]} if fold_metrics else {}, "cv_folds": len(fold_metrics), "development": probability_metrics(y_dev, development_probability, threshold), "future_test": probability_metrics(y_test, test_probability, threshold), "future_test_ci": bootstrap_ci(y_test, test_probability)}
        fitted[name], out_of_fold[name] = calibrated, development_probability
    selected = max(results, key=lambda name: (results[name]["cv"].get("average_precision", 0), -results[name]["cv"].get("brier_score", 1)))
    return selected, results, fitted, out_of_fold


def split_temporal_cohorts(frame):
    """Reject holdouts contaminated by shared students or not-yet-observed labels."""
    cutoff = frame.observed_at.quantile(.80)
    development, test = frame[frame.observed_at < cutoff], frame[frame.observed_at >= cutoff]
    if development.outcome.nunique() != 2 or test.outcome.nunique() != 2:
        raise ValueError("Development and untouched future test cohorts must each contain both outcomes.")
    if not set(development.student_id).isdisjoint(test.student_id):
        raise ValueError("Development and future test cohorts must contain different students. Supply a student-disjoint temporal cohort.")
    if development.outcome_observed_at.max() >= test.observed_at.min():
        raise ValueError("Every development outcome must be observed before the first future test feature cutoff. Supply an outcome-maturation gap.")
    return development, test, cutoff


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    parser.add_argument("--version", required=True)
    parser.add_argument("--dataset-reference", required=True)
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--horizon-days", type=int, required=True)
    parser.add_argument("--output", default="data/models")
    args = parser.parse_args()
    if not 1 <= args.horizon_days <= 365:
        raise ValueError("horizon-days must be between 1 and 365.")
    if not all(c.isalnum() or c in "-_ ." for c in args.version) or args.version in (".", ".."):
        raise ValueError("Use a safe, unique model version name.")
    frame = load_dataset(args.dataset, target=args.target).sort_values("observed_at").reset_index(drop=True)
    development, test, cutoff = split_temporal_cohorts(frame)
    selected, metrics, fitted, out_of_fold = evaluate_candidates(development, test)
    selected_probability = out_of_fold[selected]
    review_threshold = choose_threshold(development.outcome.to_numpy(), selected_probability)
    high_threshold = min(.95, max(review_threshold + .15, float(np.quantile(selected_probability, .85))))
    target_dir = Path(args.output) / args.version
    target_dir.mkdir(parents=True, exist_ok=False)
    for name, model in fitted.items():
        joblib.dump(model, target_dir / f"{name}.joblib")
    artifact_sha = hashlib.sha256((target_dir / f"{selected}.joblib").read_bytes()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    manifest = {"schema_version": 2, "version": args.version, "target": args.target, "horizon_days": args.horizon_days, "selected_algorithm": selected, "trained_at": now, "dataset_reference": args.dataset_reference, "dataset_sha256": hashlib.sha256(Path(args.dataset).read_bytes()).hexdigest(), "artifact_sha256": artifact_sha, "features": FEATURES, "rows": len(frame), "train_students": int(development.student_id.nunique()), "future_test_students": int(test.student_id.nunique()), "cutoff_contract": "All features are measured at observed_at; outcome_observed_at is later than observed_at and labels are not generated from support rules.", "thresholds": {"review": review_threshold, "high": high_threshold}, "max_age_days": max(7, args.horizon_days), "min_coverage": .75, "metrics": {"selected_algorithm": selected, "candidates": metrics, "future_cohort_cutoff": cutoff.isoformat()}, "reference_stats": {feature: {"median": None if frame[feature].dropna().empty else float(frame[feature].median()), "missing_rate": float(frame[feature].isna().mean())} for feature in FEATURES}, "validated": False, "active": False, "review_requirements": ["Confirm outcome definition, consent and feature cutoff times", "Review future-cohort and subgroup metrics with sample sizes and uncertainty", "Confirm calibration and action thresholds against faculty capacity", "Record a named institutional review before import"]}
    (target_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Saved candidates and manifest in {target_dir}. No model was validated or activated.")


if __name__ == "__main__":
    main()
