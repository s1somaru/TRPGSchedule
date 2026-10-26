-- 時刻・時間帯(spec.md 3.18)
-- 1日分の予定の時刻は、今の予定の JSON(availability)にそのまま入るので、ここでは足さない

-- 曜日ごとの「いつもの時間」(JSON: { "3": { "from": "21:00" } })。本人だけが使う
ALTER TABLE calendars ADD COLUMN weekly_times TEXT NOT NULL DEFAULT '{}';

-- 卓の時間帯(JSON: { "from": "21:00", "to": "24:00" })。NULL = 指定なし
ALTER TABLE sessions ADD COLUMN time_window TEXT;

-- 日ごとの時間帯(JSON: { "2026-11-14": { "from": "20:00" } })。卓の時間帯と違う日だけ
ALTER TABLE sessions ADD COLUMN date_times TEXT NOT NULL DEFAULT '{}';
