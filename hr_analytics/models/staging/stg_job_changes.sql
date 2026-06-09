-- Staging: clean raw_job_changes

SELECT
    CAST(change_id  AS UNSIGNED)   AS change_id,
    employee_id,
    CAST(change_date AS DATE)      AS change_date,
    LOWER(change_type)             AS change_type,
    CAST(from_dept_id  AS UNSIGNED) AS from_dept_id,
    CAST(to_dept_id    AS UNSIGNED) AS to_dept_id,
    CAST(from_level_id AS UNSIGNED) AS from_level_id,
    CAST(to_level_id   AS UNSIGNED) AS to_level_id,
    from_manager_id,
    to_manager_id,
    CAST(from_salary AS DECIMAL(12,2)) AS from_salary,
    CAST(to_salary   AS DECIMAL(12,2)) AS to_salary,
    LOWER(exit_type)               AS exit_type   -- NULL for non-terminations
FROM hr_warehouse.raw_job_changes
WHERE change_id  IS NOT NULL
  AND employee_id IS NOT NULL
