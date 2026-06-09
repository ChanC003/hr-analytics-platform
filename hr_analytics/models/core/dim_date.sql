-- dim_date: calendar dimension covering sim window + 1yr buffer
-- MySQL: recursive CTE needs cte_max_recursion_depth > 2922 (2020-01-01 to 2027-12-31)
{{ config(pre_hook="SET SESSION cte_max_recursion_depth = 5000") }}

WITH RECURSIVE date_spine AS (
    SELECT DATE('2020-01-01') AS date_day
    UNION ALL
    SELECT DATE_ADD(date_day, INTERVAL 1 DAY)
    FROM date_spine
    WHERE date_day < DATE('2027-12-31')
)

SELECT
    date_day,
    YEAR(date_day)                          AS year,
    MONTH(date_day)                         AS month,
    DAY(date_day)                           AS day,
    QUARTER(date_day)                       AS quarter,
    WEEKOFYEAR(date_day)                    AS week_of_year,
    DAYOFWEEK(date_day)                     AS day_of_week,  -- 1=Sun, 7=Sat
    DAYNAME(date_day)                       AS day_name,
    MONTHNAME(date_day)                     AS month_name,
    CONCAT(YEAR(date_day), '-Q', QUARTER(date_day)) AS year_quarter,
    CONCAT(YEAR(date_day), '-', LPAD(MONTH(date_day), 2, '0')) AS year_month_key,
    CASE WHEN DAYOFWEEK(date_day) IN (1,7) THEN 1 ELSE 0 END AS is_weekend,
    LAST_DAY(date_day)                      AS last_day_of_month
FROM date_spine
