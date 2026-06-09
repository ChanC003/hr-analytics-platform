"""
HR synthetic data generator.
Produces realistic employee lifecycle data for 10,000 employees over 3 years.

Usage:
    python generate_hr_data.py                        # defaults from .env
    python generate_hr_data.py --employees 500 --years 2 --seed 99
"""

import argparse
import os
import random
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import psycopg2
from dotenv import load_dotenv
from faker import Faker
from psycopg2.extras import execute_values

load_dotenv(Path(__file__).parents[2] / ".env")

fake = Faker("en_US")

# ─── CONFIG ──────────────────────────────────────────────────────────────────

DEPARTMENTS = {
    1: {"name": "Engineering",     "salary_band": (70_000, 180_000), "attrition_rate": 0.14},
    2: {"name": "Product",         "salary_band": (65_000, 160_000), "attrition_rate": 0.12},
    3: {"name": "Sales",           "salary_band": (50_000, 140_000), "attrition_rate": 0.22},
    4: {"name": "Operations",      "salary_band": (45_000, 110_000), "attrition_rate": 0.18},
    5: {"name": "Human Resources", "salary_band": (50_000, 120_000), "attrition_rate": 0.10},
}

LEVELS = {
    1: "Junior", 2: "Mid", 3: "Senior", 4: "Lead", 5: "Manager", 6: "Director"
}

LEVEL_SALARY_MULTIPLIER = {1: 0.6, 2: 0.8, 3: 1.0, 4: 1.2, 5: 1.4, 6: 1.7}

RECRUITMENT_STAGES = ["applied", "screening", "interview", "offer", "hired"]
RECRUITMENT_REJECTION_STAGE = "rejected"
RECRUITMENT_SOURCES = ["linkedin", "referral", "job_board", "direct", "agency"]

CHANGE_REASONS = ["hire", "promotion", "merit", "market_adj"]
EXIT_TYPES = ["voluntary", "involuntary", "retirement"]

# ─── DB ──────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        dbname=os.getenv("POSTGRES_DB", "hr_db"),
        user=os.getenv("POSTGRES_USER", "hr_user"),
        password=os.getenv("POSTGRES_PASSWORD", "hr_pass"),
    )


def truncate_all(cur):
    cur.execute("""
        TRUNCATE hr.recruitment_events, hr.job_changes, hr.performance_reviews,
                 hr.salary_history, hr.employees
        RESTART IDENTITY CASCADE
    """)

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def rand_date(start: date, end: date) -> date:
    delta = (end - start).days
    if delta <= 0:
        return start
    return start + timedelta(days=random.randint(0, delta))


def salary_for(dept_id: int, level_id: int) -> float:
    lo, hi = DEPARTMENTS[dept_id]["salary_band"]
    mult = LEVEL_SALARY_MULTIPLIER[level_id]
    base = lo + (hi - lo) * mult
    jitter = random.gauss(0, base * 0.05)
    return round(max(lo * 0.8, base + jitter), 2)


def next_level(level_id: int) -> int:
    return min(level_id + 1, 6)


def quarters_between(start: date, end: date):
    """Yield (year, quarter, quarter_start_date) for every quarter in range."""
    y, m = start.year, start.month
    while True:
        q = (m - 1) // 3 + 1
        q_start = date(y, (q - 1) * 3 + 1, 1)
        if q_start > end:
            break
        yield y, q, q_start
        m += 3
        if m > 12:
            m -= 12
            y += 1

# ─── GENERATORS ──────────────────────────────────────────────────────────────

def generate_employees(n: int, sim_start: date, sim_end: date, rng: random.Random):
    """
    Returns list of employee dicts.
    ~70% hired before sim_start (existing workforce), 30% hired during sim period.
    """
    employees = []
    used_emails = set()

    for i in range(1, n + 1):
        emp_id = f"EMP-{i:06d}"
        dept_id = rng.randint(1, 5)
        level_id = rng.choices(
            [1, 2, 3, 4, 5, 6],
            weights=[20, 30, 25, 12, 8, 5],
        )[0]

        # Hire date: 70% pre-sim, 30% during sim
        if rng.random() < 0.70:
            hire_date = rand_date(sim_start - timedelta(days=3 * 365), sim_start - timedelta(days=1))
        else:
            hire_date = rand_date(sim_start, sim_end - timedelta(days=30))

        email_base = fake.user_name()
        email = f"{email_base}@company.com"
        # Deduplicate
        suffix = 1
        while email in used_emails:
            email = f"{email_base}{suffix}@company.com"
            suffix += 1
        used_emails.add(email)

        employees.append({
            "employee_id": emp_id,
            "full_name": fake.name(),
            "email": email,
            "gender": rng.choice(["male", "female", "non_binary"]),
            "birth_date": rand_date(date(1970, 1, 1), date(2000, 1, 1)),
            "hire_date": hire_date,
            "department_id": dept_id,
            "job_title": f"{LEVELS[level_id]} {rng.choice(['Engineer','Analyst','Manager','Specialist','Coordinator'])}",
            "level_id": level_id,
            "manager_id": None,  # wired in second pass
            "employment_type": rng.choices(
                ["full_time", "part_time", "contract"],
                weights=[80, 10, 10],
            )[0],
            "status": "active",
        })

    # Wire managers: each employee's manager is a higher-level employee in same dept
    dept_by_level = {}
    for e in employees:
        key = (e["department_id"], e["level_id"])
        dept_by_level.setdefault(key, []).append(e["employee_id"])

    for e in employees:
        if e["level_id"] >= 5:  # Managers/Directors report to nobody in synthetic data
            continue
        candidates = []
        for lvl in range(e["level_id"] + 1, 7):
            candidates.extend(dept_by_level.get((e["department_id"], lvl), []))
        if candidates:
            e["manager_id"] = rng.choice(candidates)

    return employees


def generate_salary_history(employees: list, sim_start: date, sim_end: date, rng: random.Random):
    rows = []
    for e in employees:
        dept_id = e["department_id"]
        level_id = e["level_id"]
        hire_date = e["hire_date"]

        current_salary = salary_for(dept_id, level_id)
        rows.append({
            "employee_id": e["employee_id"],
            "effective_date": hire_date,
            "salary_amount": current_salary,
            "currency": "USD",
            "change_reason": "hire",
        })

        # ~18% nhân viên bị "đóng băng lương" — không tăng lương trong sim window.
        # Đây là tín hiệu nghỉ việc mạnh (causal signal cho ML).
        salary_frozen = rng.random() < 0.18
        e["_salary_frozen"] = salary_frozen
        last_raise_date = hire_date

        # Annual merit increases within sim window
        review_year = max(hire_date.year + 1, sim_start.year)
        while review_year <= sim_end.year and not salary_frozen:
            review_date = date(review_year, rng.randint(1, 3), 1)
            if review_date > sim_end or review_date <= hire_date:
                review_year += 1
                continue
            increase_pct = rng.uniform(0.02, 0.08)
            current_salary = round(current_salary * (1 + increase_pct), 2)
            last_raise_date = review_date
            rows.append({
                "employee_id": e["employee_id"],
                "effective_date": review_date,
                "salary_amount": current_salary,
                "currency": "USD",
                "change_reason": rng.choice(["merit", "market_adj"]),
            })
            review_year += 1

        e["_last_raise_date"] = last_raise_date

    return rows


def generate_performance_reviews(employees: list, sim_start: date, sim_end: date, rng: random.Random):
    rows = []
    for e in employees:
        hire_date = e["hire_date"]
        base_score = rng.gauss(3.4, 0.6)
        base_score = max(1.0, min(5.0, base_score))
        trend = rng.gauss(0, 0.05)  # slight drift per quarter

        # Lưu tín hiệu perf vào employee để attrition dùng (causal signal)
        e["_perf_base"] = base_score
        e["_perf_trend"] = trend
        last_score = base_score

        for year, quarter, q_start in quarters_between(
            max(hire_date, sim_start), sim_end
        ):
            # Skip if employee was hired within 90 days of this quarter
            if (q_start - hire_date).days < 90:
                continue

            review_date = q_start + timedelta(days=rng.randint(15, 45))
            score = base_score + trend * ((year - sim_start.year) * 4 + quarter)
            score += rng.gauss(0, 0.2)  # giảm noise để last_score phản ánh đúng base
            score = round(max(1.0, min(5.0, score)), 2)
            last_score = score

            rows.append({
                "employee_id": e["employee_id"],
                "review_date": review_date,
                "review_period": f"{year}-Q{quarter}",
                "score": score,
                "manager_id": e["manager_id"],
                "notes": None,
            })

        e["_last_score"] = last_score  # điểm review gần nhất

    return rows


def generate_job_changes_and_exits(
    employees: list, sim_start: date, sim_end: date, rng: random.Random
):
    """
    Returns (job_changes, terminated_employee_ids).
    - 15% get promoted once during sim window
    - dept-level attrition rates applied annually
    """
    job_changes = []
    terminated_ids = set()

    for e in employees:
        emp_id = e["employee_id"]
        dept_id = e["department_id"]
        hire_date = e["hire_date"]
        level_id = e["level_id"]

        # Promotion — only if tenure > 1yr and level < Director
        tenure_days = (sim_end - hire_date).days
        if tenure_days > 365 and level_id < 6 and rng.random() < 0.15:
            promo_date = rand_date(
                max(hire_date + timedelta(days=365), sim_start),
                sim_end - timedelta(days=30),
            )
            new_level = next_level(level_id)
            old_salary = salary_for(dept_id, level_id)
            new_salary = salary_for(dept_id, new_level)
            job_changes.append({
                "employee_id": emp_id,
                "change_date": promo_date,
                "change_type": "promotion",
                "from_dept_id": dept_id,
                "to_dept_id": dept_id,
                "from_level_id": level_id,
                "to_level_id": new_level,
                "from_manager_id": e["manager_id"],
                "to_manager_id": e["manager_id"],
                "from_salary": old_salary,
                "to_salary": new_salary,
                "exit_type": None,
            })
            e["level_id"] = new_level  # mutate for downstream use

        # Attrition — annual probability theo dept, ĐIỀU CHỈNH theo tín hiệu cá nhân.
        # Mục đích: tạo quan hệ nhân quả để ML học được (không còn random).
        annual_rate = DEPARTMENTS[dept_id]["attrition_rate"]
        sim_years = max(1, (sim_end - max(hire_date, sim_start)).days / 365)
        prob_exit = 1 - (1 - annual_rate) ** sim_years

        # --- Risk multipliers (mạnh để ML học rõ tín hiệu) ---
        mult = 1.0
        last_score = e.get("_last_score", 3.4)
        perf_trend = e.get("_perf_trend", 0.0)
        # Low performer nghỉ nhiều hơn nhiều; high performer được giữ chân
        if last_score < 2.5:
            mult *= 2.8
        elif last_score < 3.0:
            mult *= 1.7
        elif last_score > 4.2:
            mult *= 0.4
        # Trend giảm điểm -> bất mãn -> nghỉ
        if perf_trend < -0.03:
            mult *= 1.6
        # Lương đóng băng -> nghỉ rất mạnh
        if e.get("_salary_frozen"):
            mult *= 2.2
        # Lương lâu không tăng
        days_since_raise = (sim_end - e.get("_last_raise_date", hire_date)).days
        if days_since_raise > 600:
            mult *= 1.5
        # Nhân viên mới (tenure < 1.5yr) nghỉ nhiều hơn
        if tenure_days < 547:
            mult *= 1.7

        prob_exit = min(0.95, prob_exit * mult)

        if rng.random() < prob_exit:
            exit_date = rand_date(
                max(hire_date + timedelta(days=90), sim_start),
                sim_end,
            )
            exit_type = rng.choices(
                EXIT_TYPES, weights=[65, 25, 10]
            )[0]
            job_changes.append({
                "employee_id": emp_id,
                "change_date": exit_date,
                "change_type": "termination",
                "from_dept_id": dept_id,
                "to_dept_id": None,
                "from_level_id": e["level_id"],
                "to_level_id": None,
                "from_manager_id": e["manager_id"],
                "to_manager_id": None,
                "from_salary": salary_for(dept_id, e["level_id"]),
                "to_salary": None,
                "exit_type": exit_type,
            })
            terminated_ids.add(emp_id)
            e["status"] = "terminated"

    return job_changes, terminated_ids


def clamp_events_to_exit(salary_rows, perf_rows, job_change_rows):
    """
    Bỏ mọi event xảy ra SAU ngày nghỉ việc của nhân viên.

    Bug gốc: salary/review/promotion sinh trên toàn sim window, độc lập với exit_date
    (exit quyết định sau cùng) -> nhân viên 'được review / tăng lương / thăng chức' sau khi đã nghỉ.
    Hệ quả: dim_employee SCD2 có version valid_from > exit_date -> valid_to(=exit_date) < valid_from.

    Fix: lấy exit_date mỗi nhân viên từ termination rows, rồi loại event > exit_date.
    - salary_history, performance_reviews: drop dòng effective/review_date > exit_date.
    - job_changes: drop PROMOTION sau exit; GIỮ termination row.
    Trả về (salary_rows, perf_rows, job_change_rows) đã làm sạch + thống kê đã loại.
    """
    exit_date = {
        jc["employee_id"]: jc["change_date"]
        for jc in job_change_rows if jc["change_type"] == "termination"
    }

    def keep_sal(r):  return r["employee_id"] not in exit_date or r["effective_date"] <= exit_date[r["employee_id"]]
    def keep_perf(r): return r["employee_id"] not in exit_date or r["review_date"]   <= exit_date[r["employee_id"]]
    def keep_jc(r):
        # giữ termination luôn; promotion sau exit -> loại
        if r["change_type"] == "termination":
            return True
        eid = r["employee_id"]
        return eid not in exit_date or r["change_date"] <= exit_date[eid]

    sal2  = [r for r in salary_rows if keep_sal(r)]
    perf2 = [r for r in perf_rows   if keep_perf(r)]
    jc2   = [r for r in job_change_rows if keep_jc(r)]

    dropped = {
        "salary": len(salary_rows) - len(sal2),
        "perf":   len(perf_rows) - len(perf2),
        "promotion": len(job_change_rows) - len(jc2),
    }
    return sal2, perf2, jc2, dropped


def generate_recruitment(employees: list, sim_start: date, sim_end: date, rng: random.Random):
    """
    Funnel tuyển dụng THẬT: mỗi requisition có NHIỀU ứng viên applied, rớt dần qua từng
    stage (applied -> screening -> interview -> offer -> hired). Chỉ 1 người được hired
    chính là nhân viên thật. Mỗi candidate có 1 dòng = stage CAO NHẤT họ đạt tới.

    Conversion rate điển hình ngành tuyển dụng (rớt dần ~ phễu):
      applied -> screening ~55%, screening -> interview ~50%,
      interview -> offer ~40%, offer -> hired ~80%.
    """
    rows = []
    req_counter = 1

    hired_during_sim = [e for e in employees if sim_start <= e["hire_date"] <= sim_end]

    # Tỷ lệ qua mỗi cửa — funnel sẽ thu hẹp dần
    CONV = {"screening": 0.55, "interview": 0.50, "offer": 0.40, "hired": 0.80}
    # Số ứng viên applied / requisition: đủ để cuối cùng còn ~1 người hired
    APPLICANTS = (8, 16)

    def _emit(req_id, e, source, max_stage, base_date):
        """Ghi 1 candidate dừng ở max_stage (hoặc rejected nếu chưa hired)."""
        idx = RECRUITMENT_STAGES.index(max_stage)
        stage_date = base_date
        # candidate đi qua từng stage tới max_stage
        for stage in RECRUITMENT_STAGES[: idx + 1]:
            is_hire = (stage == "hired")
            rows.append({
                "requisition_id": req_id,
                "candidate_id": f"CAND-{rng.randint(100000, 999999)}",
                "employee_id": e["employee_id"] if is_hire else None,
                "job_title": e["job_title"],
                "department_id": e["department_id"],
                "stage": stage,
                "stage_date": stage_date,
                "source": source,
            })
            stage_date = stage_date + timedelta(days=rng.randint(2, 8))
        # nếu chưa hired -> 1 dòng rejected đánh dấu loại
        if max_stage != "hired":
            rows.append({
                "requisition_id": req_id,
                "candidate_id": f"CAND-{rng.randint(100000, 999999)}",
                "employee_id": None,
                "job_title": e["job_title"],
                "department_id": e["department_id"],
                "stage": RECRUITMENT_REJECTION_STAGE,
                "stage_date": stage_date + timedelta(days=rng.randint(1, 5)),
                "source": source,
            })

    for e in hired_during_sim:
        req_id = f"REQ-{req_counter:05d}"
        req_counter += 1
        source = rng.choice(RECRUITMENT_SOURCES)
        funnel_start = e["hire_date"] - timedelta(days=rng.randint(25, 70))
        n_applied = rng.randint(*APPLICANTS)

        hired_assigned = False
        for _ in range(n_applied):
            # mô phỏng rớt dần: bắt đầu từ applied, mỗi cửa random pass/fail
            max_stage = "applied"
            for stage in ["screening", "interview", "offer", "hired"]:
                if rng.random() <= CONV[stage]:
                    max_stage = stage
                else:
                    break
            base = funnel_start + timedelta(days=rng.randint(0, 20))
            # đảm bảo đúng 1 người hired = nhân viên thật
            if max_stage == "hired":
                if hired_assigned:
                    max_stage = "offer"   # người thứ 2 lọt tới hired -> hạ xuống offer (rớt khi nhận offer)
                else:
                    hired_assigned = True
            _emit(req_id, e, source, max_stage, base)

        # nếu không ai random tới hired -> ép 1 candidate hired (vì requisition này CÓ người được tuyển)
        if not hired_assigned:
            _emit(req_id, e, source, "hired", funnel_start + timedelta(days=rng.randint(0, 20)))

    return rows

# ─── INSERT ──────────────────────────────────────────────────────────────────

def insert_employees(cur, employees):
    # Insert without manager_id first to avoid FK self-reference ordering issues
    rows = [
        (
            e["employee_id"], e["full_name"], e["email"], e["gender"],
            e["birth_date"], e["hire_date"], e["department_id"], e["job_title"],
            e["level_id"], e["employment_type"], e["status"],
        )
        for e in employees
    ]
    execute_values(cur, """
        INSERT INTO hr.employees
            (employee_id, full_name, email, gender, birth_date, hire_date,
             department_id, job_title, level_id, employment_type, status)
        VALUES %s
        ON CONFLICT (employee_id) DO NOTHING
    """, rows)

    # Second pass: bulk-update manager_id via temp table
    manager_rows = [
        (e["manager_id"], e["employee_id"])
        for e in employees if e["manager_id"] is not None
    ]
    if manager_rows:
        cur.execute("""
            CREATE TEMP TABLE _mgr_update (manager_id VARCHAR(12), employee_id VARCHAR(12))
            ON COMMIT DROP
        """)
        execute_values(cur, "INSERT INTO _mgr_update VALUES %s", manager_rows)
        cur.execute("""
            UPDATE hr.employees e
            SET manager_id = u.manager_id
            FROM _mgr_update u
            WHERE e.employee_id = u.employee_id
        """)


def insert_salary_history(cur, rows):
    data = [
        (r["employee_id"], r["effective_date"], r["salary_amount"],
         r["currency"], r["change_reason"])
        for r in rows
    ]
    execute_values(cur, """
        INSERT INTO hr.salary_history
            (employee_id, effective_date, salary_amount, currency, change_reason)
        VALUES %s
    """, data)


def insert_performance_reviews(cur, rows):
    data = [
        (r["employee_id"], r["review_date"], r["review_period"],
         r["score"], r["manager_id"], r["notes"])
        for r in rows
    ]
    execute_values(cur, """
        INSERT INTO hr.performance_reviews
            (employee_id, review_date, review_period, score, manager_id, notes)
        VALUES %s
    """, data)


def insert_job_changes(cur, rows):
    data = [
        (
            r["employee_id"], r["change_date"], r["change_type"],
            r["from_dept_id"], r["to_dept_id"],
            r["from_level_id"], r["to_level_id"],
            r["from_manager_id"], r["to_manager_id"],
            r["from_salary"], r["to_salary"], r["exit_type"],
        )
        for r in rows
    ]
    execute_values(cur, """
        INSERT INTO hr.job_changes
            (employee_id, change_date, change_type,
             from_dept_id, to_dept_id, from_level_id, to_level_id,
             from_manager_id, to_manager_id, from_salary, to_salary, exit_type)
        VALUES %s
    """, data)


def insert_recruitment(cur, rows):
    data = [
        (r["requisition_id"], r["candidate_id"], r["employee_id"],
         r["job_title"], r["department_id"], r["stage"], r["stage_date"], r["source"])
        for r in rows
    ]
    execute_values(cur, """
        INSERT INTO hr.recruitment_events
            (requisition_id, candidate_id, employee_id, job_title,
             department_id, stage, stage_date, source)
        VALUES %s
    """, data)

# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic HR data")
    parser.add_argument("--employees", type=int,
                        default=int(os.getenv("GENERATOR_EMPLOYEE_COUNT", 10_000)))
    parser.add_argument("--years", type=int,
                        default=int(os.getenv("GENERATOR_YEARS", 3)))
    parser.add_argument("--seed", type=int,
                        default=int(os.getenv("GENERATOR_SEED", 42)))
    parser.add_argument("--truncate", action="store_true",
                        help="Truncate all HR tables before inserting")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    Faker.seed(args.seed)

    sim_end = date.today().replace(day=1) - timedelta(days=1)  # last day of previous month
    sim_start = date(sim_end.year - args.years, sim_end.month, 1)

    print(f"Simulation window: {sim_start} -> {sim_end}")
    print(f"Generating {args.employees:,} employees ...")

    employees = generate_employees(args.employees, sim_start, sim_end, rng)

    print("Generating salary history ...")
    salary_rows = generate_salary_history(employees, sim_start, sim_end, rng)

    print("Generating performance reviews ...")
    perf_rows = generate_performance_reviews(employees, sim_start, sim_end, rng)

    print("Generating job changes & exits ...")
    job_change_rows, terminated_ids = generate_job_changes_and_exits(
        employees, sim_start, sim_end, rng
    )

    # Làm sạch event sau ngày nghỉ — không ai được review/tăng lương/thăng chức sau khi đã nghỉ
    salary_rows, perf_rows, job_change_rows, dropped = clamp_events_to_exit(
        salary_rows, perf_rows, job_change_rows
    )
    print(f"  clamp-to-exit dropped: salary={dropped['salary']:,} "
          f"reviews={dropped['perf']:,} promotions={dropped['promotion']:,}")

    print("Generating recruitment funnel ...")
    recruit_rows = generate_recruitment(employees, sim_start, sim_end, rng)

    print("\nRow counts:")
    print(f"  employees:            {len(employees):>8,}")
    print(f"  salary_history:       {len(salary_rows):>8,}")
    print(f"  performance_reviews:  {len(perf_rows):>8,}")
    print(f"  job_changes:          {len(job_change_rows):>8,}")
    print(f"  recruitment_events:   {len(recruit_rows):>8,}")
    print(f"  terminated:           {len(terminated_ids):>8,}")

    print("\nConnecting to PostgreSQL ...")
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                if args.truncate:
                    print("Truncating existing data ...")
                    truncate_all(cur)

                print("Inserting employees ...")
                insert_employees(cur, employees)

                print("Inserting salary history ...")
                insert_salary_history(cur, salary_rows)

                print("Inserting performance reviews ...")
                insert_performance_reviews(cur, perf_rows)

                print("Inserting job changes ...")
                insert_job_changes(cur, job_change_rows)

                print("Inserting recruitment events ...")
                insert_recruitment(cur, recruit_rows)

        print("\nDone. All data committed.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
