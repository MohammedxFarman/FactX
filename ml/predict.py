"""Generate reviewable predictions and local SHAP factors from an explicitly approved model.

Only load local trusted model artifacts: joblib files can execute code while loading.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np
import shap
from data import FEATURES, load_dataset

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model_directory")
    parser.add_argument("features_csv")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    directory = Path(args.model_directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if not manifest.get("validated") or not manifest.get("reviewed_by") or not manifest.get("reviewed_at"):
        raise ValueError("A named institutional review and explicit validation are required. This tool will not activate an unreviewed model.")
    frame = load_dataset(args.features_csv, training=False).sort_values("observed_at").drop_duplicates("student_id", keep="last")
    pipeline = joblib.load(directory / "random_forest.joblib")
    transformed = pipeline.named_steps["imputer"].transform(frame[FEATURES])
    probability = pipeline.predict_proba(frame[FEATURES])[:, 1]
    shap_values = np.asarray(shap.TreeExplainer(pipeline.named_steps["model"])(transformed).values)
    if shap_values.ndim != 3 or shap_values.shape[2] != 2:
        raise ValueError("Unexpected SHAP output shape; explanations cannot be safely produced.")
    output = []
    for i, (_, row) in enumerate(frame.iterrows()):
        contributions = shap_values[i, :, 1]
        factors = [{"feature": FEATURES[j], "value": None if np.isnan(row[FEATURES[j]]) else float(row[FEATURES[j]]), "contribution": float(contributions[j]), "direction": "increases estimated risk" if contributions[j] > 0 else "decreases estimated risk"} for j in np.argsort(np.abs(contributions))[::-1][:4]]
        output.append({"student_id": str(row.student_id), "probability": float(probability[i]), "category": "support_review" if probability[i] >= manifest["threshold"] else "not_flagged", "factors": factors, "observed_at": row.observed_at.isoformat(), "created_at": datetime.now(timezone.utc).isoformat()})
    destination = Path(args.output)
    with destination.open("x", encoding="utf-8") as f:
        json.dump({"model": manifest, "algorithm": "random_forest", "predictions": output}, f, indent=2)
    print(f"Saved {len(output)} predictions with local SHAP explanations. Review before import.")

if __name__ == "__main__":
    main()
