-- dim_job_level: reference dimension

SELECT
    level_id,
    level_name,
    level_rank,
    CASE
        WHEN level_rank <= 2 THEN 'Individual Contributor'
        WHEN level_rank <= 4 THEN 'Senior / Lead'
        ELSE 'Management'
    END AS level_group
FROM {{ ref('stg_job_levels') }}
