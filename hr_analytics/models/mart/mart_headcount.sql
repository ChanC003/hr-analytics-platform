-- mart_headcount: monthly headcount snapshot by department + level
-- Grain: one row per (year_month_key, department_id, level_id)

WITH months AS (
    SELECT DISTINCT year_month_key, last_day_of_month
    FROM {{ ref('dim_date') }}
    WHERE date_day BETWEEN '2023-01-01' AND CURDATE()
      AND day = 1
),

active_per_month AS (
    SELECT
        m.year_month_key,
        m.last_day_of_month                         AS snapshot_date,
        e.department_id,
        e.level_id,
        COUNT(DISTINCT e.employee_id)               AS headcount,
        COUNT(DISTINCT CASE WHEN e.gender = 'female' THEN e.employee_id END) AS headcount_female,
        COUNT(DISTINCT CASE WHEN e.gender = 'male'   THEN e.employee_id END) AS headcount_male,
        COUNT(DISTINCT CASE WHEN e.employment_type = 'full_time' THEN e.employee_id END) AS headcount_ft,
        AVG(e.tenure_days)                          AS avg_tenure_days
    FROM months m
    JOIN {{ ref('dim_employee') }} e
      ON e.is_current = 1
     AND e.hire_date  <= m.last_day_of_month
     AND (e.exit_date IS NULL OR e.exit_date > m.last_day_of_month)
    GROUP BY m.year_month_key, m.last_day_of_month, e.department_id, e.level_id
)

SELECT
    a.year_month_key,
    a.snapshot_date,
    a.department_id,
    d.department_name,
    a.level_id,
    l.level_name,
    l.level_group,
    a.headcount,
    a.headcount_female,
    a.headcount_male,
    a.headcount_ft,
    ROUND(a.avg_tenure_days / 365.25, 2) AS avg_tenure_years,
    ROUND(a.headcount_female * 100.0 / NULLIF(a.headcount, 0), 1) AS pct_female
FROM active_per_month a
JOIN {{ ref('dim_department') }} d ON a.department_id = d.department_id
JOIN {{ ref('dim_job_level') }}  l ON a.level_id      = l.level_id
