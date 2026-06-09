-- dim_employee: SCD Type 2 — tracks job title and level changes over time
-- Each row = one version of an employee record
-- valid_from / valid_to bracket the period; is_current = 1 for latest version

WITH base AS (
    SELECT
        e.employee_id,
        e.full_name,
        e.email,
        e.gender,
        e.birth_date,
        e.hire_date,
        e.department_id,
        e.job_title,
        e.level_id,
        e.manager_id,
        e.employment_type,
        e.status,
        e.hire_date AS valid_from      -- initial version starts at hire
    FROM {{ ref('stg_employees') }} e
),

-- Each promotion creates a new SCD2 row — column order must match base exactly
promotions AS (
    SELECT
        jc.employee_id,
        e.full_name,
        e.email,
        e.gender,
        e.birth_date,
        e.hire_date,
        COALESCE(jc.to_dept_id,    e.department_id) AS department_id,
        e.job_title,
        COALESCE(jc.to_level_id,   e.level_id)      AS level_id,
        COALESCE(jc.to_manager_id, e.manager_id)    AS manager_id,
        e.employment_type,
        e.status,
        jc.change_date AS valid_from
    FROM {{ ref('stg_job_changes') }} jc
    JOIN {{ ref('stg_employees') }} e ON jc.employee_id = e.employee_id
    WHERE jc.change_type = 'promotion'
),

-- Combine initial + promotion versions — explicit column list avoids UNION ALL type mismatch
all_versions AS (
    SELECT employee_id, full_name, email, gender, birth_date, hire_date,
           department_id, job_title, level_id, manager_id, employment_type,
           status, valid_from, 0 AS is_promotion
    FROM base
    UNION ALL
    SELECT employee_id, full_name, email, gender, birth_date, hire_date,
           department_id, job_title, level_id, manager_id, employment_type,
           status, valid_from, 1 AS is_promotion
    FROM promotions
),

-- Rank versions per employee to compute valid_to = next valid_from - 1 day
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY employee_id
            ORDER BY valid_from, is_promotion
        ) AS version_num,
        LEAD(valid_from) OVER (
            PARTITION BY employee_id
            ORDER BY valid_from, is_promotion
        ) AS next_valid_from
    FROM all_versions
),

-- Compute exit_date from job_changes termination events
exits AS (
    SELECT employee_id, change_date AS exit_date, exit_type
    FROM {{ ref('stg_job_changes') }}
    WHERE change_type = 'termination'
)

SELECT
    -- Surrogate key: employee_id + version
    CONCAT(r.employee_id, '-V', LPAD(r.version_num, 3, '0')) AS employee_sk,
    r.employee_id,
    r.full_name,
    r.email,
    r.gender,
    r.birth_date,
    r.hire_date,
    r.department_id,
    r.job_title,
    r.level_id,
    r.manager_id,
    r.employment_type,
    r.status,
    -- SCD2 validity window
    r.valid_from,
    -- valid_to: next version start - 1 day, or exit_date for terminated, or NULL (current).
    -- GREATEST(..., valid_from) là chốt phòng thủ: nếu nguồn lỗi (event sau exit) khiến exit_date
    -- < valid_from thì kẹp valid_to = valid_from (window 1 ngày) thay vì để valid_to < valid_from.
    CASE
        WHEN r.next_valid_from IS NOT NULL
            THEN GREATEST(DATE_SUB(r.next_valid_from, INTERVAL 1 DAY), r.valid_from)
        WHEN r.status = 'terminated'
            THEN GREATEST(x.exit_date, r.valid_from)
        ELSE NULL
    END                                                        AS valid_to,
    CASE WHEN r.next_valid_from IS NULL THEN 1 ELSE 0 END     AS is_current,
    -- Tenure in days (as of today or exit date)
    DATEDIFF(
        COALESCE(x.exit_date, CURDATE()),
        r.hire_date
    )                                                          AS tenure_days,
    x.exit_date,
    x.exit_type
FROM ranked r
LEFT JOIN exits x ON r.employee_id = x.employee_id
