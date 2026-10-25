-- 開催日を複数にできるようにする(spec.md 3.10)
-- 今ある卓の開催日(1つ)は、リストの1つ目としてそのまま移す

ALTER TABLE sessions ADD COLUMN confirmed_dates TEXT NOT NULL DEFAULT '[]'; -- 開催日(JSON配列・日付順)。空 = 未確定

UPDATE sessions SET confirmed_dates = json_array(confirmed_date) WHERE confirmed_date IS NOT NULL;

ALTER TABLE sessions DROP COLUMN confirmed_date;
