"""Generate a reviewable prediction artifact from a named reviewed model."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from data import FEATURES, load_dataset


def missing(value):
    return bool(pd.isna(value))


def generate_predictions(model, frame, manifest):
    """Abstain before calling the estimator when a row lacks reviewed evidence."""
    features = manifest["features"]
    if features != FEATURES:
        raise ValueError("The reviewed feature order does not match this prediction pipeline.")
    output = []
    for _, row in frame.iterrows():
        missing_features = [feature for feature in features if missing(row[feature])]
        coverage = 1 - len(missing_features) / len(features)
        common = {"student_id": str(row.student_id), "subject_id": str(row.subject_id) if "subject_id" in row and not missing(row.subject_id) else None,
                  "observed_at": row.observed_at.isoformat(), "created_at": datetime.now(timezone.utc).isoformat(), "coverage": coverage,
                  "missing_features": missing_features, "feature_values": {feature: None if missing(row[feature]) else float(row[feature]) for feature in features}}
        if manifest["target"] in ("course_failure", "lab_failure") and not common["subject_id"]:
            raise ValueError("This outcome requires a subject_id for every prediction.")
        if coverage < manifest.get("min_coverage", .75):
            output.append({**common, "probability": None, "category": "insufficient_evidence", "factors": [], "evidence_reason": "Feature coverage is below the reviewed minimum; missing evidence is not low risk."})
            continue
        model_row = row.to_frame().T[features].astype(float)
        value = float(model.predict_proba(model_row)[0, 1])
        if not np.isfinite(value) or not 0 <= value <= 1:
            raise ValueError("The model returned an invalid probability.")
        review, high = manifest["thresholds"]["review"], manifest["thresholds"]["high"]
        output.append({**common, "probability": value, "category": "high" if value >= high else "medium" if value >= review else "low", "factors": explain(model, model_row), "evidence_reason": ""})
    return output


def explain(model, row):
    estimator = getattr(model, "estimator", model)
    if hasattr(model, "calibrated_classifiers_") and model.calibrated_classifiers_:
        estimator = model.calibrated_classifiers_[0].estimator
    base = estimator.named_steps.get("model") if hasattr(estimator, "named_steps") else estimator
    values = row[FEATURES].to_numpy(dtype=float).ravel()
    contributions = None
    direction_by_index = {}
    try:
        import shap
        transformed = estimator.named_steps["imputer"].transform(row[FEATURES])
        shap_values = np.asarray(shap.TreeExplainer(estimator.named_steps["model"])(transformed).values)
        contributions = shap_values[0, :len(FEATURES), 1] if shap_values.ndim == 3 else shap_values[0, :len(FEATURES)]
    except Exception:
        if hasattr(base, "feature_importances_"):
            contributions = np.asarray(base.feature_importances_)[:len(FEATURES)]
            direction_by_index = {index: "model importance; direction unavailable" for index in range(len(FEATURES))}
        elif hasattr(base, "coef_"):
            transformed = estimator.named_steps["imputer"].transform(row[FEATURES])
            transformed = estimator.named_steps["scale"].transform(transformed)
            contributions = np.asarray(base.coef_[0])[:len(FEATURES)] * transformed[0, :len(FEATURES)]
    if contributions is None:
        contributions = np.zeros(len(FEATURES))
    order = np.argsort(np.abs(contributions))[::-1][:4]
    return [{"feature": FEATURES[index], "value": None if missing(values[index]) else float(values[index]), "contribution": float(contributions[index]), "direction": direction_by_index.get(index, "increases estimated risk" if contributions[index] > 0 else "decreases estimated risk")} for index in order]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model_directory")
    parser.add_argument("features_csv")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    directory = Path(args.model_directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 2 or not manifest.get("validated") or not manifest.get("reviewed_by") or not manifest.get("reviewed_at"):
        raise ValueError("A schema v2 model with an explicit named institutional review is required.")
    frame = load_dataset(args.features_csv, training=False).sort_values("observed_at")
    key = ["student_id", "subject_id"] if "subject_id" in frame else ["student_id"]
    frame = frame.drop_duplicates(key, keep="last")
    model = joblib.load(directory / f"{manifest['selected_algorithm']}.joblib")
    output = generate_predictions(model, frame, manifest)
    destination = Path(args.output)
    with destination.open("x", encoding="utf-8") as handle:
        json.dump({"model": manifest, "algorithm": manifest["selected_algorithm"], "predictions": output}, handle, indent=2)
    print(f"Saved {len(output)} reviewable predictions; no application model was activated.")


if __name__ == "__main__":
    main()
