-- mart_compensation: salary band analysis by department + level
-- Grain: one row per (department_id, level_id) — current snapshot
-- MySQL percentile: SUBSTRING_INDEX(GROUP_CONCAT(ORDER BY), ',', n) technique

WITH current_salaries AS (
    SELECT
        s.employee_id,
        s.salary_amount,
        e.department_id,
        e.level_id,
        e.status
    FROM {{ ref('fct_salary') }} s
    JOIN {{ ref('dim_employee') }} e
      ON s.employee_id = e.employee_id
     AND e.is_current  = 1
    WHERE (s.employee_id, s.salary_seq) IN (
        SELECT employee_id, MAX(salary_seq)
        FROM {{ ref('fct_salary') }}
        GROUP BY employee_id
    )
    AND e.status = 'active'
),

-- Row-number within each (department, level) group for percentile math
ranked AS (
    SELECT
        employee_id,
        salary_amount,
        department_id,
        level_id,
        ROW_NUMBER() OVER (PARTITION BY department_id, level_id ORDER BY salary_amount) AS rn,
        COUNT(*)     OVER (PARTITION BY department_id, level_id)                        AS grp_cnt
    FROM current_salaries
)

SELECT
    r.department_id,
    d.department_name,
    r.level_id,
    l.level_name,
    l.level_group,
    MAX(r.grp_cnt)                                              AS employee_count,
    ROUND(MIN(r.salary_amount), 0)                             AS salary_min,
    ROUND(MAX(r.salary_amount), 0)                             AS salary_max,
    ROUND(AVG(r.salary_amount), 0)                             AS salary_avg,
    -- p25: row at ~25% of ordered group
    ROUND(MAX(CASE WHEN r.rn = FLOOR(r.grp_cnt * 0.25) + 1 THEN r.salary_amount END), 0) AS salary_p25,
    -- median (p50)
    ROUND(MAX(CASE WHEN r.rn = FLOOR(r.grp_cnt * 0.50) + 1 THEN r.salary_amount END), 0) AS salary_median,
    -- p75
    ROUND(MAX(CASE WHEN r.rn = FLOOR(r.grp_cnt * 0.75) + 1 THEN r.salary_amount END), 0) AS salary_p75,
    -- spread: (max - min) / avg
    ROUND(
        (MAX(r.salary_amount) - MIN(r.salary_amount))
        / NULLIF(AVG(r.salary_amount), 0) * 100, 1)           AS salary_spread_pct
FROM ranked r
JOIN {{ ref('dim_department') }} d ON r.department_id = d.department_id
JOIN {{ ref('dim_job_level') }}  l ON r.level_id      = l.level_id
GROUP BY r.department_id, d.department_name, r.level_id, l.level_name, l.level_group
ORDER BY r.department_id, r.level_id
