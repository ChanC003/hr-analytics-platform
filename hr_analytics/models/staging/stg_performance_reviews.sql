-- Staging: clean raw_performance_reviews

SELECT
    CAST(review_id  AS UNSIGNED)       AS review_id,
    employee_id,
    CAST(review_date AS DATE)          AS review_date,
    review_period,
    -- Extract year and quarter from period string "2023-Q2"
    CAST(LEFT(review_period, 4) AS UNSIGNED)                      AS review_year,
    CAST(RIGHT(review_period, 1) AS UNSIGNED)                     AS review_quarter,
    CAST(score AS DECIMAL(3,2))        AS score,
    manager_id
FROM hr_warehouse.raw_performance_reviews
WHERE review_id   IS NOT NULL
  AND employee_id IS NOT NULL
  AND score BETWEEN 1.0 AND 5.0
