-- Engine: MySQL 8.0
-- Raw layer — analytical warehouse, mirrors PostgreSQL OLTP 1:1
-- All date columns stored as DATE/DATETIME, numerics as DECIMAL/BIGINT

CREATE TABLE IF NOT EXISTS raw_employees (
    employee_id      VARCHAR(12)  NOT NULL,
    full_name        VARCHAR(150),
    email            VARCHAR(200),
    gender           VARCHAR(10),
    birth_date       DATE,
    hire_date        DATE,
    department_id    BIGINT,
    job_title        VARCHAR(100),
    level_id         BIGINT,
    manager_id       VARCHAR(12),
    employment_type  VARCHAR(20),
    status           VARCHAR(20),
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.employees',
    PRIMARY KEY (employee_id),
    INDEX idx_hire_date (hire_date),
    INDEX idx_dept (department_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_departments (
    department_id    BIGINT       NOT NULL,
    department_name  VARCHAR(100),
    parent_id        BIGINT,
    created_at       DATETIME,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.departments',
    PRIMARY KEY (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_job_levels (
    level_id         BIGINT       NOT NULL,
    level_name       VARCHAR(50),
    level_rank       BIGINT,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.job_levels',
    PRIMARY KEY (level_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_salary_history (
    salary_id        BIGINT       NOT NULL,
    employee_id      VARCHAR(12),
    effective_date   DATE,
    salary_amount    DECIMAL(12,2),
    currency         VARCHAR(3),
    change_reason    VARCHAR(50),
    created_at       DATETIME,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.salary_history',
    PRIMARY KEY (salary_id),
    INDEX idx_emp_date (employee_id, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_performance_reviews (
    review_id        BIGINT       NOT NULL,
    employee_id      VARCHAR(12),
    review_date      DATE,
    review_period    VARCHAR(20),
    score            DECIMAL(3,2),
    manager_id       VARCHAR(12),
    notes            TEXT,
    created_at       DATETIME,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.performance_reviews',
    PRIMARY KEY (review_id),
    INDEX idx_emp_date (employee_id, review_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_job_changes (
    change_id        BIGINT       NOT NULL,
    employee_id      VARCHAR(12),
    change_date      DATE,
    change_type      VARCHAR(30),
    from_dept_id     BIGINT,
    to_dept_id       BIGINT,
    from_level_id    BIGINT,
    to_level_id      BIGINT,
    from_manager_id  VARCHAR(12),
    to_manager_id    VARCHAR(12),
    from_salary      DECIMAL(12,2),
    to_salary        DECIMAL(12,2),
    exit_type        VARCHAR(30),
    created_at       DATETIME,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.job_changes',
    PRIMARY KEY (change_id),
    INDEX idx_emp_date (employee_id, change_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS raw_recruitment_events (
    event_id         BIGINT       NOT NULL,
    requisition_id   VARCHAR(20),
    candidate_id     VARCHAR(20),
    employee_id      VARCHAR(12),
    job_title        VARCHAR(100),
    department_id    BIGINT,
    stage            VARCHAR(30),
    stage_date       DATE,
    source           VARCHAR(50),
    created_at       DATETIME,
    _loaded_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _source          VARCHAR(50)  NOT NULL DEFAULT 'postgres.hr.recruitment_events',
    PRIMARY KEY (event_id),
    INDEX idx_req_date (requisition_id, stage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Watermark table to track incremental load progress
CREATE TABLE IF NOT EXISTS _load_watermarks (
    table_name       VARCHAR(100) NOT NULL,
    last_loaded_id   BIGINT       NOT NULL DEFAULT 0,
    last_loaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    rows_loaded      BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO _load_watermarks (table_name, last_loaded_id) VALUES
  ('employees', 0),
  ('departments', 0),
  ('job_levels', 0),
  ('salary_history', 0),
  ('performance_reviews', 0),
  ('job_changes', 0),
  ('recruitment_events', 0);
