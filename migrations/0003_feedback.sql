-- 問い合わせと評価(spec.md 3.17)

CREATE TABLE feedback (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('contact', 'rating')), -- contact = 問い合わせ、rating = 評価
  rating     INTEGER CHECK (rating BETWEEN 1 AND 5),                -- 評価の★の数(問い合わせでは NULL)
  category   TEXT CHECK (category IN ('bug', 'request', 'question', 'other')), -- 問い合わせの種類
  message    TEXT NOT NULL DEFAULT '',                              -- 内容・ひとこと
  contact    TEXT,                                                  -- 返信先(任意)。個人情報なので1年で消す
  page       TEXT,                                                  -- 送った画面の種類("/"・"/c"・"/s" など。ID は入れない)
  created_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_created ON feedback (created_at);
