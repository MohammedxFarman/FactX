# FactX academic risk pipeline

FactX keeps model estimates separate from transparent support rules. No model is bundled, predictions are never fabricated, and training never activates a model automatically.

## Synthetic pipeline check

To generate an explicitly synthetic dataset and exercise all three candidate
algorithms for each of the four outcomes, run:

```powershell
python ml/synthetic_check.py
```

The reproducible default uses seed 42 and 1,200 invented students per outcome.
It simulates noisy future outcomes from latent factors, rather than copying the
application's support-rule thresholds. These labels are **not real observed
student outcomes**. The chronological split keeps 960 development students and
240 later holdout students separate, with a 60-day gap so development outcomes
precede the holdout features. Model selection and thresholds use development
cross-validation only; probability calibration also keeps students in separate
folds, including inside each outer validation fold.

Generated CSVs, model files, candidate metrics, fresh-input predictions, and
`REPORT.md` are saved under `data/synthetic-risk-<timestamp>/` and excluded from
Git. `results.json` includes all candidates, baseline comparisons, uncertainty
intervals, and checks for changed records and missing evidence. Override `--seed`,
`--rows`, or `--output` to run another experiment; output directories must be new.

This test harness calls the prediction function directly. It does not bypass the
production CLI's named-review requirement, create student accounts, import model
predictions, or activate automatic prediction refresh in the application. All
model manifests remain unvalidated and inactive. Synthetic metrics demonstrate
pipeline behavior and recovery of invented patterns, **not accuracy on real
students or suitability for institutional decisions**.

## Real-data training and review

The pipeline supports four independently defined outcomes: `course_failure`, `attendance_shortage`, `assignment_delay`, and `lab_failure`. Features are measured at `observed_at`; the approved outcome is recorded later at `outcome_observed_at`. The loader rejects missing dates, malformed or nonfinite measurements, invalid ranges/counts, and outcomes recorded before the cutoff. Training requires observed base features, both outcomes, and minimum sample counts. Prediction accepts missing measurements and returns `insufficient_evidence` before scoring rows below the reviewed coverage threshold.

Install the optional Python dependencies:

```powershell
python -m pip install -r ml/requirements.txt
```

Run `npm run test:ml` after installing these dependencies to check missing-evidence handling and input validation using isolated synthetic fixtures. These tests do not train or activate an institutional model.

Train candidates for one reviewed outcome and horizon:

```powershell
python ml/train.py path/to/validated.csv --target attendance_shortage --horizon-days 30 --version cohort-2026-v1 --dataset-reference approved-cohort-2026
```

Training uses a time-ordered development/future holdout split and grouped cross-validation by student. It compares Random Forest, Logistic Regression, and HistGradientBoosting, calibrates probabilities when possible, chooses a review threshold under an alert-rate guard, reports PR-AUC, ROC-AUC, Brier score, log loss, precision, recall, F1/F2, confusion matrix, and a bootstrap PR-AUC interval, and writes a manifest with feature and dataset hashes. It does not mark the model reviewed or active.

After an actual institutional review, add a named `reviewed_by`, `reviewed_at`, and `validated: true` to the immutable manifest. Confirm the outcome definition, consent, temporal holdout, calibration, subgroup sample sizes, action capacity, and fairness before using it. Then create a current feature snapshot and export predictions:

```powershell
python ml/predict.py data/models/cohort-2026-v1 path/to/current-features.csv --output data/predictions-for-review.json
```

Predictions contain calibrated probabilities, low/medium/high bands, coverage, missing features, and up to four SHAP or model-importance factors. If coverage is below the reviewed minimum, the output is `insufficient_evidence` with no probability. It does not silently change the active model.

Import only a reviewed artifact into the application:

```powershell
node server/import-predictions.js data/predictions-for-review.json --activate-reviewed-version cohort-2026-v1
```

The importer validates the schema, target-specific subject scope, thresholds, timestamps, freshness, coverage, student and department boundaries, explanation features, and idempotent fingerprints. Use `/api/risk/features` to export a scoped cutoff snapshot and `/api/risk/monitoring` to inspect stored model coverage by cohort. Those snapshots are current record views; they are not reconstructed historical data, so save them before an outcome window starts and join independently observed outcomes afterward.

The assistant can use these reviewed estimates alongside authorized institutional documents through RAG to suggest practical study or faculty follow-up actions. It must describe factors as associations, cite its sources, and keep a faculty member in the review loop. RAG and the timetable upload workflow use LangGraph orchestration; LangChain is only a supporting dependency and is not required for retrieval itself.

Do not load untrusted joblib/pickle files. Restrict access to model directories and exported student features. Use reviewed models for supportive human intervention, never automatic disciplinary or exclusion decisions. LSTM/GRU and clustering remain deferred until an adequate longitudinal dataset and an evaluated use case exist.
