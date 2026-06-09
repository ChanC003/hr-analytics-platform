-- Staging: clean raw_recruitment_events

SELECT
    CAST(event_id      AS UNSIGNED)  AS event_id,
    requisition_id,
    candidate_id,
    employee_id,
    TRIM(job_title)                  AS job_title,
    CAST(department_id AS UNSIGNED)  AS department_id,
    LOWER(stage)                     AS stage,
    CAST(stage_date AS DATE)         AS stage_date,
    LOWER(COALESCE(source, 'unknown')) AS source,
    -- Flag: did this candidate get hired?
    CASE WHEN LOWER(stage) = 'hired' THEN 1 ELSE 0 END AS is_hired,
    CASE WHEN LOWER(stage) = 'rejected' THEN 1 ELSE 0 END AS is_rejected
FROM hr_warehouse.raw_recruitment_events
WHERE event_id IS NOT NULL
