-- Staging: clean raw_job_levels

SELECT
    CAST(level_id   AS UNSIGNED)  AS level_id,
    TRIM(level_name)              AS level_name,
    CAST(level_rank AS UNSIGNED)  AS level_rank
FROM hr_warehouse.raw_job_levels
WHERE level_id IS NOT NULL
