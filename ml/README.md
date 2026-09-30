# FactX academic risk pipeline

No model is bundled, no predictions are fabricated, and no synthetic dataset is generated. Academic support rules in the application are separate from this pipeline.

Install the optional Python dependencies with `python -m pip install -r ml/requirements.txt`. Supply an institution-validated CSV containing `student_id`, `observed_at`, `outcome` (0 or 1, with an approved academic outcome definition), and the feature columns listed in `data.py`. Values must be computed before the outcome observation window to avoid leakage. Missing measurements remain missing; they must not be replaced by invented zeroes.

`python ml/train.py path/to/validated.csv --version cohort-2026-v1 --dataset-reference approved-cohort-2026`

The training command validates the contract, splits students into disjoint training and holdout partitions, trains Random Forest and Logistic Regression candidates, and records metrics, dataset hash, features, and version. Models remain inactive. An institution must review temporal performance, calibration, subgroup quality, consent, and appropriate use. The minimum dataset size is a basic guard, not evidence that a model is accurate.

After an actual named review, record `validated: true`, `reviewed_by`, and `reviewed_at` in the immutable version's manifest. Then run `python ml/predict.py data/models/cohort-2026-v1 path/to/current-features.csv --output data/predictions-for-review.json`. This generates probabilities and genuine local SHAP contributions. It does not silently change the active model.

LSTM/GRU and clustering are intentionally deferred until an adequate longitudinal dataset and an evaluated use case exist. The current dataset contract does not pretend a tabular snapshot is a time series.

Never load untrusted joblib/pickle files. Restrict access to model directories and exported student features. Use reviewed models for supportive human intervention, not automatic disciplinary or exclusion decisions.
