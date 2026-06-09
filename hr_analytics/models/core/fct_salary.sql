-- fct_salary: one row per salary event, enriched with YoY delta

WITH sal AS (
    SELECT * FROM {{ ref('stg_salary_history') }}
),

with_delta AS (
    SELECT
        s.salary_id,
        s.employee_id,
        s.effective_date,
        s.salary_amount,
        s.currency,
        s.change_reason,
        LAG(s.salary_amount) OVER (
            PARTITION BY s.employee_id ORDER BY s.effective_date
        ) AS prev_salary,
        ROW_NUMBER() OVER (
            PARTITION BY s.employee_id ORDER BY s.effective_date
        ) AS salary_seq
    FROM sal s
)

SELECT
    d.salary_id,
    d.employee_id,
    d.effective_date,
    d.salary_amount,
    d.currency,
    d.change_reason,
    d.prev_salary,
    d.salary_seq,
    ROUND(d.salary_amount - COALESCE(d.prev_salary, d.salary_amount), 2) AS salary_delta,
    ROUND(
        (d.salary_amount - COALESCE(d.prev_salary, d.salary_amount))
        / NULLIF(d.prev_salary, 0) * 100,
        2
    )                                                                      AS salary_delta_pct,
    dt.year_quarter
FROM with_delta d
LEFT JOIN {{ ref('dim_date') }} dt ON d.effective_date = dt.date_day
