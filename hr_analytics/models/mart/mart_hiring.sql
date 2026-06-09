-- mart_hiring: funnel conversion and time-to-hire by department + quarter
-- Grain: one row per (year_quarter, department_id)

-- Mỗi requisition: đếm SỐ ỨNG VIÊN đạt tới từng stage (funnel thu hẹp dần)
WITH funnel AS (
    SELECT
        department_id,
        requisition_id,
        MIN(stage_date)                             AS funnel_start,
        MAX(CASE WHEN stage = 'hired' THEN stage_date END) AS hired_date,
        MAX(CASE WHEN stage = 'offer' THEN stage_date END) AS offer_date,
        MAX(CASE WHEN stage = 'hired' THEN 1 ELSE 0 END)   AS was_hired,
        -- đếm candidate distinct đạt mỗi stage
        COUNT(DISTINCT CASE WHEN stage = 'applied'   THEN candidate_id END) AS reached_applied,
        COUNT(DISTINCT CASE WHEN stage = 'screening' THEN candidate_id END) AS reached_screening,
        COUNT(DISTINCT CASE WHEN stage = 'interview' THEN candidate_id END) AS reached_interview,
        COUNT(DISTINCT CASE WHEN stage = 'offer'     THEN candidate_id END) AS reached_offer
    FROM {{ ref('stg_recruitment_events') }}
    GROUP BY department_id, requisition_id
),

by_quarter AS (
    SELECT
        d.year_quarter,
        YEAR(f.funnel_start)                        AS year,
        QUARTER(f.funnel_start)                     AS quarter,
        f.department_id,
        COUNT(DISTINCT f.requisition_id)            AS total_requisitions,
        SUM(f.reached_applied)                      AS cnt_applied,
        SUM(f.reached_screening)                    AS cnt_screening,
        SUM(f.reached_interview)                    AS cnt_interview,
        SUM(f.reached_offer)                        AS cnt_offer,
        SUM(f.was_hired)                            AS cnt_hired,
        -- Time-to-hire: days from funnel_start to hired_date
        ROUND(AVG(
            CASE WHEN f.was_hired = 1
            THEN DATEDIFF(f.hired_date, f.funnel_start)
            END
        ), 1)                                       AS avg_days_to_hire,
        ROUND(AVG(
            CASE WHEN f.was_hired = 1
            THEN DATEDIFF(f.offer_date, f.funnel_start)
            END
        ), 1)                                       AS avg_days_to_offer
    FROM funnel f
    LEFT JOIN {{ ref('dim_date') }} d ON f.funnel_start = d.date_day
    GROUP BY d.year_quarter, YEAR(f.funnel_start), QUARTER(f.funnel_start), f.department_id
)

SELECT
    b.year_quarter,
    b.year,
    b.quarter,
    b.department_id,
    dp.department_name,
    b.total_requisitions,
    b.cnt_applied,
    b.cnt_screening,
    b.cnt_interview,
    b.cnt_offer,
    b.cnt_hired,
    -- Funnel conversion rates
    ROUND(b.cnt_screening * 100.0 / NULLIF(b.cnt_applied,   0), 1) AS screening_rate_pct,
    ROUND(b.cnt_interview * 100.0 / NULLIF(b.cnt_screening, 0), 1) AS interview_rate_pct,
    ROUND(b.cnt_offer     * 100.0 / NULLIF(b.cnt_interview, 0), 1) AS offer_rate_pct,
    ROUND(b.cnt_hired     * 100.0 / NULLIF(b.cnt_offer,     0), 1) AS offer_accept_rate_pct,
    ROUND(b.cnt_hired     * 100.0 / NULLIF(b.cnt_applied,   0), 1) AS overall_hire_rate_pct,
    b.avg_days_to_hire,
    b.avg_days_to_offer
FROM by_quarter b
JOIN {{ ref('dim_department') }} dp ON b.department_id = dp.department_id
ORDER BY b.year_quarter, b.department_id
