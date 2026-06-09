"""
PostgreSQL → MySQL incremental loader.

Strategy:
  - Full load for small reference tables (departments, job_levels)
  - Incremental load for fact tables using serial PK watermark
  - employees: REPLACE INTO (handles status changes active → terminated)

Usage:
    python load_to_mysql.py                   # incremental (default)
    python load_to_mysql.py --full-load       # truncate + reload all tables
    python load_to_mysql.py --table salary_history
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import mysql.connector
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

BATCH_SIZE = 5_000

# ─── CONNECTIONS ─────────────────────────────────────────────────────────────

def pg_conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.getenv("POSTGRES_PORT", 5433)),
        dbname=os.getenv("POSTGRES_DB", "hr_db"),
        user=os.getenv("POSTGRES_USER", "hr_user"),
        password=os.getenv("POSTGRES_PASSWORD", "hr_pass"),
    )


def my_conn():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        database=os.getenv("MYSQL_DB", "hr_warehouse"),
        user=os.getenv("MYSQL_USER", "hr_analyst"),
        password=os.getenv("MYSQL_PASSWORD", "hr_mysql_pass"),
        autocommit=False,
    )

# ─── TABLE CONFIG ─────────────────────────────────────────────────────────────

# (pg_table, mysql_table, pk_col, load_mode)
TABLE_CONFIG = [
    ("hr.departments",        "raw_departments",        "department_id", "full"),
    ("hr.job_levels",         "raw_job_levels",         "level_id",      "full"),
    ("hr.employees",          "raw_employees",          "employee_id",   "replace"),
    ("hr.salary_history",     "raw_salary_history",     "salary_id",     "incremental_pk"),
    ("hr.performance_reviews","raw_performance_reviews","review_id",     "incremental_pk"),
    ("hr.job_changes",        "raw_job_changes",        "change_id",     "incremental_pk"),
    ("hr.recruitment_events", "raw_recruitment_events", "event_id",      "incremental_pk"),
]

PG_SELECT = {
    "hr.departments": "SELECT department_id, department_name, parent_id, created_at FROM hr.departments",
    "hr.job_levels":  "SELECT level_id, level_name, level_rank FROM hr.job_levels",
    "hr.employees": """
        SELECT employee_id, full_name, email, gender, birth_date, hire_date,
               department_id, job_title, level_id, manager_id, employment_type, status
        FROM hr.employees
    """,
    "hr.salary_history": """
        SELECT salary_id, employee_id, effective_date, salary_amount, currency,
               change_reason, created_at
        FROM hr.salary_history WHERE salary_id > %s ORDER BY salary_id
    """,
    "hr.performance_reviews": """
        SELECT review_id, employee_id, review_date, review_period, score,
               manager_id, notes, created_at
        FROM hr.performance_reviews WHERE review_id > %s ORDER BY review_id
    """,
    "hr.job_changes": """
        SELECT change_id, employee_id, change_date, change_type,
               from_dept_id, to_dept_id, from_level_id, to_level_id,
               from_manager_id, to_manager_id, from_salary, to_salary,
               exit_type, created_at
        FROM hr.job_changes WHERE change_id > %s ORDER BY change_id
    """,
    "hr.recruitment_events": """
        SELECT event_id, requisition_id, candidate_id, employee_id, job_title,
               department_id, stage, stage_date, source, created_at
        FROM hr.recruitment_events WHERE event_id > %s ORDER BY event_id
    """,
}

MYSQL_INSERT = {
    "raw_departments":        "INSERT IGNORE INTO raw_departments (department_id,department_name,parent_id,created_at) VALUES (%s,%s,%s,%s)",
    "raw_job_levels":         "INSERT IGNORE INTO raw_job_levels (level_id,level_name,level_rank) VALUES (%s,%s,%s)",
    "raw_employees":          "REPLACE INTO raw_employees (employee_id,full_name,email,gender,birth_date,hire_date,department_id,job_title,level_id,manager_id,employment_type,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
    "raw_salary_history":     "INSERT IGNORE INTO raw_salary_history (salary_id,employee_id,effective_date,salary_amount,currency,change_reason,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
    "raw_performance_reviews":"INSERT IGNORE INTO raw_performance_reviews (review_id,employee_id,review_date,review_period,score,manager_id,notes,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
    "raw_job_changes":        "INSERT IGNORE INTO raw_job_changes (change_id,employee_id,change_date,change_type,from_dept_id,to_dept_id,from_level_id,to_level_id,from_manager_id,to_manager_id,from_salary,to_salary,exit_type,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
    "raw_recruitment_events": "INSERT IGNORE INTO raw_recruitment_events (event_id,requisition_id,candidate_id,employee_id,job_title,department_id,stage,stage_date,source,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
}

# ─── WATERMARK ────────────────────────────────────────────────────────────────

def get_watermark(my_cur, table_name: str) -> int:
    my_cur.execute(
        "SELECT last_loaded_id FROM _load_watermarks WHERE table_name = %s",
        (table_name,),
    )
    row = my_cur.fetchone()
    return row[0] if row else 0


def update_watermark(my_cur, table_name: str, last_id: int, rows_loaded: int):
    my_cur.execute("""
        UPDATE _load_watermarks
        SET last_loaded_id = %s, rows_loaded = rows_loaded + %s
        WHERE table_name = %s
    """, (last_id, rows_loaded, table_name))

# ─── LOAD STRATEGIES ─────────────────────────────────────────────────────────

def load_full(pg_cur, my_cur, pg_table: str, mysql_table: str) -> int:
    log.info(f"  [full] Truncating {mysql_table} ...")
    my_cur.execute(f"TRUNCATE TABLE {mysql_table}")

    # Strip WHERE clause for full load (incremental queries have %s placeholder)
    query = PG_SELECT[pg_table]
    if "%s" in query:
        query = query[:query.index("WHERE")].strip()
    pg_cur.execute(query)
    rows = pg_cur.fetchall()
    if not rows:
        return 0

    for i in range(0, len(rows), BATCH_SIZE):
        my_cur.executemany(MYSQL_INSERT[mysql_table], rows[i:i + BATCH_SIZE])

    log.info(f"  [full] {len(rows):,} rows -> {mysql_table}")
    return len(rows)


def load_incremental_pk(pg_cur, my_cur, pg_table: str, mysql_table: str) -> int:
    short = pg_table.split(".")[-1]
    wm = get_watermark(my_cur, short)
    log.info(f"  [incr] {mysql_table}: watermark={wm:,} ...")

    pg_cur.execute(PG_SELECT[pg_table], (wm,))
    total = 0
    last_id = wm
    while True:
        rows = pg_cur.fetchmany(BATCH_SIZE)
        if not rows:
            break
        my_cur.executemany(MYSQL_INSERT[mysql_table], rows)
        last_id = rows[-1][0]
        total += len(rows)

    if total:
        update_watermark(my_cur, short, last_id, total)
        log.info(f"  [incr] +{total:,} rows -> {mysql_table} (watermark: {last_id:,})")
    else:
        log.info(f"  [incr] {mysql_table}: nothing new.")
    return total


def load_replace(pg_cur, my_cur, pg_table: str, mysql_table: str) -> int:
    """REPLACE INTO handles both insert and update (status changes)."""
    log.info(f"  [replace] Loading all from {pg_table} ...")
    pg_cur.execute(PG_SELECT[pg_table])
    rows = pg_cur.fetchall()
    if not rows:
        return 0

    for i in range(0, len(rows), BATCH_SIZE):
        my_cur.executemany(MYSQL_INSERT[mysql_table], rows[i:i + BATCH_SIZE])

    log.info(f"  [replace] {len(rows):,} rows -> {mysql_table}")
    return len(rows)

# ─── ORCHESTRATE ──────────────────────────────────────────────────────────────

def run_load(tables_filter=None, full_load=False):
    started_at = datetime.now(timezone.utc)
    log.info(f"Load started | mode={'FULL' if full_load else 'INCREMENTAL'}")

    pg = my = None
    pg_cur = my_cur = None
    try:
        pg = pg_conn()
        my = my_conn()
        pg_cur = pg.cursor()
        my_cur = my.cursor()

        total_rows = 0
        for pg_table, mysql_table, pk_col, default_mode in TABLE_CONFIG:
            short = pg_table.split(".")[-1]
            if tables_filter and short not in tables_filter:
                continue

            log.info(f"Loading {pg_table} -> {mysql_table} ...")
            mode = "full" if full_load else default_mode

            if mode == "full":
                n = load_full(pg_cur, my_cur, pg_table, mysql_table)
            elif mode == "incremental_pk":
                n = load_incremental_pk(pg_cur, my_cur, pg_table, mysql_table)
            elif mode == "replace":
                n = load_replace(pg_cur, my_cur, pg_table, mysql_table)
            else:
                log.error(f"Unknown mode: {mode}")
                n = 0

            total_rows += n

        my.commit()
        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        log.info(f"Done: {total_rows:,} rows in {elapsed:.1f}s")

    except Exception:
        if my:
            my.rollback()
        log.exception("Load failed — rolled back.")
        sys.exit(1)
    finally:
        for c in [pg_cur, my_cur]:
            if c:
                c.close()
        for conn in [pg, my]:
            if conn:
                conn.close()

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="PostgreSQL -> MySQL incremental loader")
    parser.add_argument("--full-load", action="store_true")
    parser.add_argument("--table", nargs="+", metavar="TABLE")
    args = parser.parse_args()
    run_load(
        tables_filter=set(args.table) if args.table else None,
        full_load=args.full_load,
    )

if __name__ == "__main__":
    main()
