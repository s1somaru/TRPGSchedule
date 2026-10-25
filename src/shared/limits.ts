// 入力の上限値(spec.md 5.7)。画面からも読むので、入力チェックのライブラリには頼らない
export const LIMITS = {
  displayName: 20,
  memo: 100,
  title: 50,
  candidateDates: 60,
  participants: 30,
  availabilityPerRequest: 200,
} as const;

export const ShareTokenTtl = { default: 86400, min: 60, max: 86400 } as const;
