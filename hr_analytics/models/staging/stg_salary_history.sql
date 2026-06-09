-- Staging: clean raw_salary_history

SELECT
    CAST(salary_id     AS UNSIGNED)    AS salary_id,
    employee_id,
    CAST(effective_date AS DATE)       AS effective_date,
    CAST(salary_amount  AS DECIMAL(12,2)) AS salary_amount,
    UPPER(COALESCE(currency, 'USD'))   AS currency,
    LOWER(COALESCE(change_reason, 'unknown')) AS change_reason
FROM hr_warehouse.raw_salary_history
WHERE salary_id    IS NOT NULL
  AND employee_id  IS NOT NULL
  AND salary_amount > 0
