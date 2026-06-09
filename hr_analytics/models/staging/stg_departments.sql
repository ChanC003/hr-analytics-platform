-- Staging: clean raw_departments

SELECT
    CAST(department_id AS UNSIGNED)  AS department_id,
    TRIM(department_name)            AS department_name,
    CAST(parent_id AS UNSIGNED)      AS parent_id
FROM hr_warehouse.raw_departments
WHERE department_id IS NOT NULL
