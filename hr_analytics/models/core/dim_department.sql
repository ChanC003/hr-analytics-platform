-- dim_department: reference dimension, SCD Type 1 (no history needed)

SELECT
    department_id,
    department_name,
    parent_id,
    CASE department_id
        WHEN 1 THEN 'Engineering'
        WHEN 2 THEN 'Product'
        WHEN 3 THEN 'Sales'
        WHEN 4 THEN 'Operations'
        WHEN 5 THEN 'Human Resources'
        ELSE 'Other'
    END AS department_group
FROM {{ ref('stg_departments') }}
