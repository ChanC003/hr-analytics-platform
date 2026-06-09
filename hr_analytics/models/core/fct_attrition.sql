-- fct_attrition: one row per employee who exited
-- Enriched with last perf score, salary, and tenure at exit

WITH exits AS (
    SELECT *
    FROM {{ ref('stg_job_changes') }}
    WHERE change_type = 'termination'
),

-- Last salary before exit
last_salary AS (
    SELECT
        s.employee_id,
        s.salary_amount AS last_salary,
        s.effective_date AS salary_as_of
    FROM {{ ref('stg_salary_history') }} s
    WHERE (s.employee_id, s.effective_date) IN (
        SELECT employee_id, MAX(effective_date)
        FROM {{ ref('stg_salary_history') }}
        GROUP BY employee_id
    )
),

-- Last perf score before exit
last_perf AS (
    SELECT
        p.employee_id,
        p.score AS last_perf_score,
        p.score_4q_avg AS last_4q_avg_score
    FROM {{ ref('fct_performance') }} p
    WHERE (p.employee_id, p.review_seq) IN (
        SELECT employee_id, MAX(review_seq)
        FROM {{ ref('fct_performance') }}
        GROUP BY employee_id
    )
)

SELECT
    x.change_id                             AS attrition_id,
    x.employee_id,
    x.change_date                           AS exit_date,
    x.exit_type,
    e.department_id,
    e.level_id,
    e.hire_date,
    DATEDIFF(x.change_date, e.hire_date)    AS tenure_days,
    ROUND(DATEDIFF(x.change_date, e.hire_date) / 365.25, 2) AS tenure_years,
    ls.last_salary,
    lp.last_perf_score,
    lp.last_4q_avg_score,
    d.year_quarter                          AS exit_year_quarter,
    YEAR(x.change_date)                     AS exit_year,
    QUARTER(x.change_date)                  AS exit_quarter
FROM exits x
JOIN {{ ref('stg_employees') }} e  ON x.employee_id = e.employee_id
LEFT JOIN last_salary ls           ON x.employee_id = ls.employee_id
LEFT JOIN last_perf lp             ON x.employee_id = lp.employee_id
LEFT JOIN {{ ref('dim_date') }} d  ON x.change_date = d.date_day
