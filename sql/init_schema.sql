-- Engine: PostgreSQL
-- HR OLTP schema — source of truth for the data generator

CREATE SCHEMA IF NOT EXISTS hr;

-- ─── REFERENCE TABLES ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr.departments (
    department_id   SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL,
    parent_id       INT REFERENCES hr.departments(department_id),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.job_levels (
    level_id    SERIAL PRIMARY KEY,
    level_name  VARCHAR(50) NOT NULL,  -- Junior / Mid / Senior / Lead / Manager / Director
    level_rank  INT NOT NULL           -- 1=Junior … 6=Director
);

-- ─── CORE TABLES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr.employees (
    employee_id     VARCHAR(12) PRIMARY KEY,  -- EMP-000001
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(200) NOT NULL UNIQUE,
    gender          VARCHAR(10),
    birth_date      DATE,
    hire_date       DATE NOT NULL,
    department_id   INT NOT NULL REFERENCES hr.departments(department_id),
    job_title       VARCHAR(100) NOT NULL,
    level_id        INT NOT NULL REFERENCES hr.job_levels(level_id),
    manager_id      VARCHAR(12) REFERENCES hr.employees(employee_id),
    employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time',  -- full_time / part_time / contract
    status          VARCHAR(20) NOT NULL DEFAULT 'active',     -- active / terminated / on_leave
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.salary_history (
    salary_id       SERIAL PRIMARY KEY,
    employee_id     VARCHAR(12) NOT NULL REFERENCES hr.employees(employee_id),
    effective_date  DATE NOT NULL,
    salary_amount   NUMERIC(12, 2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    change_reason   VARCHAR(50),  -- hire / promotion / merit / market_adj / correction
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.performance_reviews (
    review_id       SERIAL PRIMARY KEY,
    employee_id     VARCHAR(12) NOT NULL REFERENCES hr.employees(employee_id),
    review_date     DATE NOT NULL,
    review_period   VARCHAR(20) NOT NULL,  -- 2023-Q1 … 2025-Q4
    score           NUMERIC(3, 2) NOT NULL CHECK (score BETWEEN 1.0 AND 5.0),
    manager_id      VARCHAR(12) REFERENCES hr.employees(employee_id),
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.job_changes (
    change_id       SERIAL PRIMARY KEY,
    employee_id     VARCHAR(12) NOT NULL REFERENCES hr.employees(employee_id),
    change_date     DATE NOT NULL,
    change_type     VARCHAR(30) NOT NULL,  -- promotion / transfer / demotion / termination / rehire
    from_dept_id    INT REFERENCES hr.departments(department_id),
    to_dept_id      INT REFERENCES hr.departments(department_id),
    from_level_id   INT REFERENCES hr.job_levels(level_id),
    to_level_id     INT REFERENCES hr.job_levels(level_id),
    from_manager_id VARCHAR(12) REFERENCES hr.employees(employee_id),
    to_manager_id   VARCHAR(12) REFERENCES hr.employees(employee_id),
    from_salary     NUMERIC(12, 2),
    to_salary       NUMERIC(12, 2),
    exit_type       VARCHAR(30),  -- voluntary / involuntary / retirement (for terminations)
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.recruitment_events (
    event_id        SERIAL PRIMARY KEY,
    requisition_id  VARCHAR(20) NOT NULL,
    candidate_id    VARCHAR(20) NOT NULL,
    employee_id     VARCHAR(12) REFERENCES hr.employees(employee_id),  -- set when hired
    job_title       VARCHAR(100) NOT NULL,
    department_id   INT NOT NULL REFERENCES hr.departments(department_id),
    stage           VARCHAR(30) NOT NULL,  -- applied / screening / interview / offer / hired / rejected
    stage_date      DATE NOT NULL,
    source          VARCHAR(50),           -- linkedin / referral / job_board / direct
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_employees_dept    ON hr.employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_status  ON hr.employees(status);
CREATE INDEX IF NOT EXISTS idx_salary_emp        ON hr.salary_history(employee_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_perf_emp          ON hr.performance_reviews(employee_id, review_date);
CREATE INDEX IF NOT EXISTS idx_jobchg_emp        ON hr.job_changes(employee_id, change_date);
CREATE INDEX IF NOT EXISTS idx_recruit_req       ON hr.recruitment_events(requisition_id, stage_date);

-- ─── SEED: JOB LEVELS ────────────────────────────────────────────────────────

INSERT INTO hr.job_levels (level_name, level_rank) VALUES
  ('Junior',    1),
  ('Mid',       2),
  ('Senior',    3),
  ('Lead',      4),
  ('Manager',   5),
  ('Director',  6)
ON CONFLICT DO NOTHING;

-- ─── SEED: DEPARTMENTS ───────────────────────────────────────────────────────

INSERT INTO hr.departments (department_name, parent_id) VALUES
  ('Engineering',     NULL),
  ('Product',         NULL),
  ('Sales',           NULL),
  ('Operations',      NULL),
  ('Human Resources', NULL)
ON CONFLICT DO NOTHING;
