-- fct_performance: one row per quarterly review
-- Joins to dim_employee current version for context

WITH reviews AS (
    SELECT * FROM {{ ref('stg_performance_reviews') }}
),

-- Rolling 4-quarter average score per employee (perf trend signal for ML)
rolling_avg AS (
    SELECT
        review_id,
        employee_id,
        review_date,
        score,
        AVG(score) OVER (
            PARTITION BY employee_id
            ORDER BY review_date
            ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
        ) AS score_4q_avg,
        LAG(score, 1) OVER (
            PARTITION BY employee_id ORDER BY review_date
        ) AS prev_score,
        ROW_NUMBER() OVER (
            PARTITION BY employee_id ORDER BY review_date
        ) AS review_seq
    FROM reviews
)

SELECT
    r.review_id,
    r.employee_id,
    r.review_date,
    d.year_quarter,
    r.review_year,
    r.review_quarter,
    r.score,
    ra.score_4q_avg,
    ra.prev_score,
    -- Score delta vs previous review (positive = improving)
    ROUND(r.score - COALESCE(ra.prev_score, r.score), 2)  AS score_delta,
    ra.review_seq,
    r.manager_id
FROM reviews r
JOIN rolling_avg ra ON r.review_id = ra.review_id
LEFT JOIN {{ ref('dim_date') }} d ON r.review_date = d.date_day
