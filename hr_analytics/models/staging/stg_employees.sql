-- Staging: clean raw_employees
-- Cast types, normalize nulls, add surrogate key hint

WITH source AS (
    SELECT * FROM hr_warehouse.raw_employees
)

SELECT
    employee_id,
    full_name,
    LOWER(TRIM(email))                                AS email,
    LOWER(COALESCE(gender, 'unknown'))                AS gender,
    CAST(birth_date AS DATE)                          AS birth_date,
    CAST(hire_date  AS DATE)                          AS hire_date,
    CAST(department_id AS UNSIGNED)                   AS department_id,
    TRIM(job_title)                                   AS job_title,
    CAST(level_id AS UNSIGNED)                        AS level_id,
    manager_id,
    LOWER(employment_type)                            AS employment_type,
    LOWER(status)                                     AS status,
    _loaded_at
FROM source
WHERE employee_id IS NOT NULL
  AND hire_date   IS NOT NULL
