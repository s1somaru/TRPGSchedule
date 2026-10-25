// 入力の上限値(spec.md 5.7)。画面からも読むので、入力チェックのライブラリには頼らない
export const LIMITS = {
  displayName: 20,
  memo: 100,
  title: 50,
  candidateDates: 60,
  participants: 30,
  availabilityPerRequest: 200,
} as const;

/**
 * 実際の長さの上限(JavaScript の文字数)。見た目の文字数とは別に、とても長いデータを防ぐ。
 * 絵文字の組み合わせ(家族の絵文字など)は見た目1文字でも8文字ぶんになるので、見た目の上限の8倍にしておく
 */
export const RAW_LIMITS = {
  displayName: 160,
  memo: 800,
  title: 400,
} as const;

/** 問い合わせ・評価の上限(見た目の文字数) */
export const FEEDBACK_LIMITS = {
  contactMessage: 2000,
  ratingMessage: 500,
  replyTo: 100,
} as const;

/** 1つのカレンダーの予定全体の大きさの上限(文字数) */
export const MAX_AVAILABILITY_CHARS = 131072;

