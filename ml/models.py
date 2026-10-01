from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def candidates():
    return {
        "random_forest": Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)), ("model", RandomForestClassifier(n_estimators=400, min_samples_leaf=5, max_features="sqrt", class_weight="balanced", random_state=42, n_jobs=-1))]),
        "logistic_regression": Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)), ("scale", StandardScaler()), ("model", LogisticRegression(max_iter=3000, class_weight="balanced", C=0.5, random_state=42))]),
        "hist_gradient_boosting": Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)), ("model", HistGradientBoostingClassifier(max_iter=250, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0, random_state=42))]),
    }
