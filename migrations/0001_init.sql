-- 最初のテーブル定義(spec.md 8.1)

-- 個人カレンダー
CREATE TABLE calendars (
  id               TEXT PRIMARY KEY,
  edit_secret_hash TEXT NOT NULL UNIQUE,       -- 編集URLの秘密のハッシュ。秘密そのものは保存しない
  token_generation INTEGER NOT NULL DEFAULT 0, -- 再発行のたびに +1。古い共有トークンを無効にする
  display_name     TEXT NOT NULL,
  availability     TEXT NOT NULL DEFAULT '{}', -- 予定(JSON): { "YYYY-MM-DD": { "s": "o", "memo": "..." } }
  created_at       TEXT NOT NULL,
  last_updated_at  TEXT NOT NULL,              -- 予定か表示名が変わったとき(画面に出す)
  last_accessed_at TEXT NOT NULL               -- 最後に本人として使った日時(古いカレンダーの削除に使う)
);

-- 卓
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  candidate_dates TEXT NOT NULL,  -- 候補日(JSON配列・日付順)
  confirmed_date  TEXT,           -- 確定日。NULL = 未確定
  last_date       TEXT NOT NULL,  -- 確定日があればそれ、なければ最後の候補日
  archived_at     TEXT,           -- NULL = 進行中。値があれば記録になった卓
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- 卓への参加
CREATE TABLE participations (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  calendar_id           TEXT REFERENCES calendars(id) ON DELETE SET NULL, -- NULL = カレンダーが削除された
  role                  TEXT NOT NULL CHECK (role IN ('GM', 'PL')),
  display_name_override TEXT,  -- この卓だけの名前。NULL = カレンダーの名前を使う
  display_name_snapshot TEXT,  -- 記録になったとき・カレンダーが消えたときに書き写した名前
  joined_at             TEXT NOT NULL,
  UNIQUE (session_id, calendar_id)  -- 同じカレンダーで二重に参加させない
);

CREATE INDEX idx_participations_calendar ON participations (calendar_id);
CREATE INDEX idx_sessions_archive        ON sessions (archived_at, last_date);
CREATE INDEX idx_calendars_last_accessed ON calendars (last_accessed_at);
