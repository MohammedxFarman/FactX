"""Train candidate models on institution-validated records; never auto-activate one.

python ml/train.py validated.csv --version 2026-01 --dataset-reference approved-cohort-v1
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import joblib
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_fscore_support, roc_auc_score, confusion_matrix
from data import FEATURES, load_dataset
from models import candidates

def main():
    p = argparse.ArgumentParser()
    p.add_argument("dataset")
    p.add_argument("--version", required=True)
    p.add_argument("--dataset-reference", required=True)
    p.add_argument("--output", default="data/models")
    args = p.parse_args()
    if not all(c.isalnum() or c in "-_ ." for c in args.version) or args.version in (".", ".."):
        raise ValueError("Use a safe, unique model version name.")
    frame = load_dataset(args.dataset)
    train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=.25, random_state=42).split(frame, groups=frame.student_id))
    train, test = frame.iloc[train_idx], frame.iloc[test_idx]
    if train.outcome.nunique() != 2 or test.outcome.nunique() != 2:
        raise ValueError("Both partitions must contain both outcomes. Collect more validated data.")
    target = Path(args.output) / args.version
    target.mkdir(parents=True, exist_ok=False)  # Never overwrite an existing model.
    metrics = {}
    for name, pipeline in candidates().items():
        pipeline.fit(train[FEATURES], train.outcome)
        probability = pipeline.predict_proba(test[FEATURES])[:, 1]
        precision, recall, f1, _ = precision_recall_fscore_support(test.outcome, probability >= .5, average="binary", zero_division=0)
        metrics[name] = {"roc_auc": float(roc_auc_score(test.outcome, probability)), "average_precision": float(average_precision_score(test.outcome, probability)), "brier_score": float(brier_score_loss(test.outcome, probability)), "precision": float(precision), "recall": float(recall), "f1": float(f1), "confusion_matrix": confusion_matrix(test.outcome, probability >= .5).tolist()}
        joblib.dump(pipeline, target / f"{name}.joblib")
    manifest = {"version": args.version, "trained_at": datetime.now(timezone.utc).isoformat(), "dataset_reference": args.dataset_reference, "dataset_sha256": hashlib.sha256(Path(args.dataset).read_bytes()).hexdigest(), "features": FEATURES, "rows": len(frame), "train_students": int(train.student_id.nunique()), "holdout_students": int(test.student_id.nunique()), "split": "Student-disjoint holdout (25%). Requires independent temporal validation before deployment.", "threshold": .5, "metrics": metrics, "validated": False, "active": False, "review_requirements": ["Verify outcome definition and feature cutoff times", "Evaluate temporal generalization and calibration", "Review subgroup performance and data governance", "Approve the model version explicitly before registration"]}
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Candidate models saved in {target}. They are NOT approved or activated.")

if __name__ == "__main__":
    main()
