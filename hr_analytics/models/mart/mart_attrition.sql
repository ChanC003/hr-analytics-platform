-- mart_attrition: quarterly attrition metrics by department
-- Grain: one row per (year_quarter, department_id)

WITH exits_by_quarter AS (
    SELECT
        a.exit_year_quarter,
        a.exit_year,
        a.exit_quarter,
        a.department_id,
        COUNT(*)                                              AS exits_total,
        COUNT(CASE WHEN a.exit_type = 'voluntary'   THEN 1 END) AS exits_voluntary,
        COUNT(CASE WHEN a.exit_type = 'involuntary' THEN 1 END) AS exits_involuntary,
        COUNT(CASE WHEN a.exit_type = 'retirement'  THEN 1 END) AS exits_retirement,
        ROUND(AVG(a.tenure_years), 2)                         AS avg_tenure_at_exit,
        ROUND(AVG(a.last_perf_score), 2)                      AS avg_last_perf_score,
        ROUND(AVG(a.last_salary), 0)                          AS avg_last_salary
    FROM {{ ref('fct_attrition') }} a
    GROUP BY a.exit_year_quarter, a.exit_year, a.exit_quarter, a.department_id
),

-- Average headcount in that quarter for the rate denominator
avg_hc AS (
    SELECT
        year_month_key,
        department_id,
        SUM(headcount) AS total_hc
    FROM {{ ref('mart_headcount') }}
    GROUP BY year_month_key, department_id
),

quarterly_hc AS (
    SELECT
        CONCAT(YEAR(STR_TO_DATE(CONCAT(year_month_key, '-01'), '%Y-%m-%d')), '-Q',
               QUARTER(STR_TO_DATE(CONCAT(year_month_key, '-01'), '%Y-%m-%d'))) AS year_quarter,
        department_id,
        AVG(total_hc) AS avg_quarterly_hc
    FROM avg_hc
    GROUP BY year_quarter, department_id
)

SELECT
    e.exit_year_quarter,
    e.exit_year,
    e.exit_quarter,
    e.department_id,
    d.department_name,
    e.exits_total,
    e.exits_voluntary,
    e.exits_involuntary,
    e.exits_retirement,
    ROUND(h.avg_quarterly_hc, 0)                                           AS avg_headcount,
    ROUND(e.exits_total * 100.0 / NULLIF(h.avg_quarterly_hc, 0), 2)       AS attrition_rate_pct,
    ROUND(e.exits_voluntary * 100.0 / NULLIF(e.exits_total, 0), 1)        AS voluntary_pct,
    e.avg_tenure_at_exit,
    e.avg_last_perf_score,
    e.avg_last_salary
FROM exits_by_quarter e
LEFT JOIN quarterly_hc h       ON e.exit_year_quarter = h.year_quarter
                               AND e.department_id     = h.department_id
JOIN {{ ref('dim_department') }} d ON e.department_id = d.department_id
ORDER BY e.exit_year_quarter, e.department_id
