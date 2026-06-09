"""Unit test pure logic của generator — không cần DB.

Tập trung: salary_for (lương theo band/cấp), next_level (thăng cấp), quarters_between (sinh quý),
và clamp_events_to_exit (regression cho bug 'event sau ngày nghỉ' đã fix ở Phase 4c).
"""
import random
from datetime import date

import pytest

import generate_hr_data as g


# ── salary_for ──────────────────────────────────────────────────────────────
def test_salary_for_in_band_range():
    random.seed(42)
    # Junior (mult 0.6) Engineering — phải nằm quanh band thấp, không âm, >= sàn 0.8*lo
    for _ in range(50):
        s = g.salary_for(1, 1)
        lo, hi = g.DEPARTMENTS[1]["salary_band"]
        assert s >= lo * 0.8
        assert s < hi * 1.3  # jitter nhỏ, không vượt xa hi


def test_salary_increases_with_level():
    random.seed(0)
    # Director (6) median lương > Junior (1) cùng phòng (multiplier tăng dần)
    junior = sum(g.salary_for(2, 1) for _ in range(200)) / 200
    director = sum(g.salary_for(2, 6) for _ in range(200)) / 200
    assert director > junior


# ── next_level ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("cur,expected", [(1, 2), (3, 4), (5, 6), (6, 6)])
def test_next_level_caps_at_director(cur, expected):
    assert g.next_level(cur) == expected


# ── quarters_between ────────────────────────────────────────────────────────
def test_quarters_between_count_and_shape():
    qs = list(g.quarters_between(date(2024, 1, 15), date(2024, 12, 31)))
    assert len(qs) == 4                       # Q1..Q4 2024
    assert qs[0] == (2024, 1, date(2024, 1, 1))
    assert qs[-1] == (2024, 4, date(2024, 10, 1))


def test_quarters_between_spans_years():
    qs = list(g.quarters_between(date(2023, 11, 1), date(2024, 2, 1)))
    # 2023-Q4 và 2024-Q1
    assert (2023, 4, date(2023, 10, 1)) in qs
    assert (2024, 1, date(2024, 1, 1)) in qs


# ── clamp_events_to_exit (regression Phase 4c) ──────────────────────────────
def test_clamp_drops_events_after_exit():
    """Event xảy ra SAU exit_date phải bị loại; trước/bằng exit_date thì giữ."""
    exit_d = date(2025, 6, 30)
    salary = [
        {"employee_id": "E1", "effective_date": date(2024, 1, 1)},   # giữ
        {"employee_id": "E1", "effective_date": date(2026, 1, 1)},   # SAU exit -> bỏ
        {"employee_id": "E2", "effective_date": date(2025, 1, 1)},   # E2 không nghỉ -> giữ
    ]
    perf = [
        {"employee_id": "E1", "review_date": date(2025, 6, 1)},      # giữ (<= exit)
        {"employee_id": "E1", "review_date": date(2025, 12, 1)},     # SAU exit -> bỏ
    ]
    jc = [
        {"employee_id": "E1", "change_type": "termination", "change_date": exit_d},  # luôn giữ
        {"employee_id": "E1", "change_type": "promotion",   "change_date": date(2026, 3, 1)},  # SAU exit -> bỏ
        {"employee_id": "E1", "change_type": "promotion",   "change_date": date(2024, 5, 1)},  # giữ
    ]

    sal2, perf2, jc2, dropped = g.clamp_events_to_exit(salary, perf, jc)

    assert dropped == {"salary": 1, "perf": 1, "promotion": 1}
    # E1 sau-exit bị loại, E2 giữ
    assert all(r["effective_date"] <= exit_d for r in sal2 if r["employee_id"] == "E1")
    assert {r["employee_id"] for r in sal2} == {"E1", "E2"}
    # termination row luôn còn
    assert any(r["change_type"] == "termination" for r in jc2)
    # không còn promotion sau exit
    assert all(r["change_date"] <= exit_d for r in jc2 if r["change_type"] == "promotion")


def test_clamp_noop_when_no_exit():
    """Nhân viên chưa nghỉ (không có termination) -> giữ nguyên mọi event."""
    salary = [{"employee_id": "E9", "effective_date": date(2030, 1, 1)}]
    perf = [{"employee_id": "E9", "review_date": date(2030, 1, 1)}]
    jc = [{"employee_id": "E9", "change_type": "promotion", "change_date": date(2030, 1, 1)}]
    sal2, perf2, jc2, dropped = g.clamp_events_to_exit(salary, perf, jc)
    assert dropped == {"salary": 0, "perf": 0, "promotion": 0}
    assert len(sal2) == 1 and len(perf2) == 1 and len(jc2) == 1
