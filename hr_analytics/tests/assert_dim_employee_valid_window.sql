-- Test: SCD2 window phải hợp lệ — valid_to không bao giờ trước valid_from.
-- Bug gốc (đã fix ở generator clamp_events_to_exit + GREATEST trong dim_employee.sql):
-- event sau exit_date khiến version valid_from > exit_date -> valid_to < valid_from.
-- Test fail (trả về > 0 dòng) nếu còn sót.

SELECT employee_sk, valid_from, valid_to
FROM {{ ref('dim_employee') }}
WHERE valid_to IS NOT NULL
  AND valid_to < valid_from
