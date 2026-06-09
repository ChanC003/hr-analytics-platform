"""
build_features.py — Point-in-time feature builder cho attrition model.

Thiết kế tránh data leakage:
  - Chọn CUTOFF_DATE. Population = nhân viên đang active TẠI cutoff.
  - Feature chỉ tính từ data <= cutoff (review_date, effective_date).
  - Label `left_180d` = 1 nếu nhân viên nghỉ trong (cutoff, cutoff + HORIZON_DAYS].

Dùng cho:
  - train: cutoff trong quá khứ (mặc định 2025-06-30) -> có đủ horizon để biết nhãn.
  - score: cutoff = hôm nay -> nhãn chưa biết, chỉ build X để predict.
"""

import os
import sys
import datetime as dt
import pandas as pd
import mysql.connector
from sqlalchemy import create_engine
from dotenv import load_dotenv

# Windows cp1252 console -> ép UTF-8 cho output tiếng Việt
sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

HORIZON_DAYS = 180  # cửa sổ dự đoán nghỉ việc

MYSQL_CFG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "database": os.getenv("MYSQL_DB", "hr_warehouse"),
    "user": os.getenv("MYSQL_USER", "hr_analyst"),
    "password": os.getenv("MYSQL_PASSWORD", "hr_mysql_pass"),
}

# SQLAlchemy engine — pandas.read_sql cần connectable này (mysql.connector raw bị warning).
# Tái dùng 1 engine cho cả process (pool connection).
_ENGINE = None


def _engine():
    global _ENGINE
    if _ENGINE is None:
        url = (
            f"mysql+mysqlconnector://{MYSQL_CFG['user']}:{MYSQL_CFG['password']}"
            f"@{MYSQL_CFG['host']}:{MYSQL_CFG['port']}/{MYSQL_CFG['database']}"
        )
        _ENGINE = create_engine(url, pool_pre_ping=True)
    return _ENGINE


def _conn():
    """Raw connector — vẫn dùng cho score_attrition (executemany INSERT)."""
    return mysql.connector.connect(**MYSQL_CFG)


def build_features(cutoff_date: str, for_training: bool = True) -> pd.DataFrame:
    """
    Trả về DataFrame 1 dòng / employee active tại cutoff.
    Nếu for_training=True: thêm cột label `left_180d` (cần data exit sau cutoff).
    """
    cutoff = cutoff_date
    horizon_end = (
        dt.date.fromisoformat(cutoff) + dt.timedelta(days=HORIZON_DAYS)
    ).isoformat()

    # Dùng Connection (eng.connect()) thay vì Engine cho pd.read_sql — chạy đúng trên CẢ SQLAlchemy
    # 1.4 (môi trường Airflow yêu cầu <2.0) lẫn 2.0 (host). Truyền Engine thẳng bị lỗi
    # "'Engine' object has no attribute 'cursor'" trên pandas 2.2 + SQLAlchemy 1.4.
    with _engine().connect() as conn:
        # --- Population: active tại cutoff ---
        # Point-in-time: dùng is_current=1 để lấy dept/level. Đã verify (1,324 cặp version SCD2)
        # promotion KHÔNG đổi department_id/level_id -> 0 rò rỉ thực tế. KHÔNG dùng valid_to lọc
        # population: 394 bản terminated có valid_to < valid_from (corrupt). Active-check theo hire/exit_date.
        pop = pd.read_sql(
            """
            SELECT
                employee_id, gender, birth_date, hire_date,
                department_id, level_id, employment_type,
                exit_date
            FROM dim_employee
            WHERE is_current = 1
              AND hire_date <= %(cutoff)s
              AND (exit_date IS NULL OR exit_date > %(cutoff)s)
            """,
            conn,
            params={"cutoff": cutoff},
        )

        # --- Performance features: chỉ review <= cutoff ---
        perf = pd.read_sql(
            """
            SELECT employee_id, review_date, score, score_4q_avg,
                   score_delta, manager_id
            FROM fct_performance
            WHERE review_date <= %(cutoff)s
            ORDER BY employee_id, review_date
            """,
            conn,
            params={"cutoff": cutoff},
        )

        # --- Salary features: chỉ effective <= cutoff ---
        sal = pd.read_sql(
            """
            SELECT employee_id, effective_date, salary_amount,
                   salary_delta_pct
            FROM fct_salary
            WHERE effective_date <= %(cutoff)s
            ORDER BY employee_id, effective_date
            """,
            conn,
            params={"cutoff": cutoff},
        )

    cutoff_d = dt.date.fromisoformat(cutoff)

    # ---- Aggregate performance per employee (last value + trend) ----
    if not perf.empty:
        perf_last = perf.groupby("employee_id").tail(1).set_index("employee_id")
        perf_agg = perf.groupby("employee_id").agg(
            num_reviews=("score", "size"),
            num_managers=("manager_id", "nunique"),
            avg_score=("score", "mean"),
        )
        perf_feat = perf_agg.join(
            perf_last[["score", "score_4q_avg", "score_delta"]].rename(
                columns={
                    "score": "last_score",
                    "score_4q_avg": "last_4q_avg",
                    "score_delta": "last_score_delta",
                }
            )
        )
    else:
        perf_feat = pd.DataFrame()

    # ---- Aggregate salary per employee ----
    if not sal.empty:
        sal_last = sal.groupby("employee_id").tail(1).set_index("employee_id")
        sal_agg = sal.groupby("employee_id").agg(
            num_salary_changes=("salary_amount", "size"),
        )
        sal_last2 = sal_last.copy()
        sal_last2["days_since_last_raise"] = sal_last2["effective_date"].apply(
            lambda d: (cutoff_d - d).days
        )
        sal_feat = sal_agg.join(
            sal_last2[["salary_amount", "salary_delta_pct", "days_since_last_raise"]].rename(
                columns={
                    "salary_amount": "current_salary",
                    "salary_delta_pct": "last_salary_delta_pct",
                }
            )
        )
    else:
        sal_feat = pd.DataFrame()

    # ---- Department attrition rate (lịch sử <= cutoff, không leak tương lai) ----
    dept_rate = _dept_attrition_rate(cutoff)

    # ---- Merge ----
    df = pop.set_index("employee_id")
    df = df.join(perf_feat).join(sal_feat)
    df = df.reset_index()

    # ---- Derived: tuổi, tenure tại cutoff ----
    df["age"] = df["birth_date"].apply(lambda d: _years_between(d, cutoff_d))
    df["tenure_days_at_cutoff"] = df["hire_date"].apply(lambda d: (cutoff_d - d).days)
    df["dept_attrition_rate"] = df["department_id"].map(dept_rate).fillna(0.0)

    # ---- Label ----
    if for_training:
        df["left_180d"] = df["exit_date"].apply(
            lambda d: 1 if (d is not None and pd.notna(d)
                            and cutoff_d < d <= dt.date.fromisoformat(horizon_end)) else 0
        )

    # ---- Drop cột raw không dùng làm feature ----
    df = df.drop(columns=["birth_date", "hire_date", "exit_date"])

    # ---- Fill NA cho numeric features (nhân viên chưa có review/salary) ----
    num_defaults = {
        "num_reviews": 0, "num_managers": 0, "avg_score": 0,
        "last_score": 0, "last_4q_avg": 0, "last_score_delta": 0,
        "num_salary_changes": 0, "current_salary": 0,
        "last_salary_delta_pct": 0, "days_since_last_raise": 9999,
    }
    for col, val in num_defaults.items():
        if col in df.columns:
            df[col] = df[col].fillna(val)

    return df


def _dept_attrition_rate(cutoff: str) -> dict:
    """Tỷ lệ nghỉ lịch sử mỗi dept tính tới cutoff: exits<=cutoff / total_ever_hired<=cutoff.

    Point-in-time: numerator = số đã nghỉ tới cutoff, denominator = số từng được tuyển tới cutoff
    (cùng tập is_current). Không nhìn tương lai (exit_date <= cutoff). Đây là tỷ lệ nghỉ *tích luỹ
    lịch sử* của phòng — proxy cho 'môi trường phòng', không phải rate tức thời.
    """
    with _engine().connect() as conn:
        rate = pd.read_sql(
            """
            SELECT
                department_id,
                SUM(CASE WHEN exit_date IS NOT NULL AND exit_date <= %(cutoff)s
                         THEN 1 ELSE 0 END)                          AS exits,
                COUNT(*)                                             AS total
            FROM dim_employee
            WHERE is_current = 1
              AND hire_date <= %(cutoff)s
            GROUP BY department_id
            """,
            conn,
            params={"cutoff": cutoff},
        )
    rate["r"] = rate["exits"] / rate["total"].replace(0, 1)
    return dict(zip(rate["department_id"], rate["r"]))


def _years_between(d, ref: dt.date) -> float:
    if d is None or pd.isna(d):
        return 0.0
    return round((ref - d).days / 365.25, 1)


# Cột categorical cần encode (dùng chung train + score)
CATEGORICAL = ["gender", "employment_type"]
# Cột không phải feature
ID_COLS = ["employee_id"]
LABEL_COL = "left_180d"


def feature_columns(df: pd.DataFrame) -> list:
    return [c for c in df.columns if c not in ID_COLS + [LABEL_COL]]


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default="2025-06-30")
    ap.add_argument("--no-label", action="store_true", help="build cho scoring (không cần label)")
    args = ap.parse_args()

    df = build_features(args.cutoff, for_training=not args.no_label)
    print(f"Cutoff: {args.cutoff} | rows: {len(df)} | cols: {len(df.columns)}")
    print(f"Columns: {list(df.columns)}")
    if LABEL_COL in df.columns:
        pos = int(df[LABEL_COL].sum())
        print(f"Label left_180d: {pos} positive / {len(df)} ({pos/len(df)*100:.1f}%)")
    print(df.head(3).to_string())
