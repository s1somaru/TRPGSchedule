// 入力チェックの定義(spec.md 5.7)。サーバーと画面で同じものを使う
import * as v from "valibot";
import { isValidDate } from "./dates";
import { ID_PATTERNS } from "./ids";
import { cleanMultiLine, cleanSingleLine } from "./text";

export const LIMITS = {
  displayName: 20,
  memo: 100,
  title: 50,
  candidateDates: 60,
  participants: 30,
  availabilityPerRequest: 200,
} as const;

export const ShareTokenTtl = { default: 86400, min: 60, max: 86400 } as const;

/** 日付("YYYY-MM-DD" で実在する日) */
export const DateString = v.pipe(
  v.string(),
  v.check(isValidDate, "日付の形が正しくありません"),
);

/** 表示名(カレンダー・卓ごとの上書きとも) */
export const DisplayName = v.pipe(
  v.string(),
  v.transform(cleanSingleLine),
  v.minGraphemes(1, "名前を入れてください"),
  v.maxGraphemes(LIMITS.displayName, `名前は${LIMITS.displayName}文字までです`),
);

/** メモ。空なら「メモなし」として扱う */
export const Memo = v.pipe(
  v.string(),
  v.transform(cleanMultiLine),
  v.maxGraphemes(LIMITS.memo, `メモは${LIMITS.memo}文字までです`),
);

export const StatusSchema = v.picklist(["o", "t", "x"], "記号は ◯ △ × のどれかです");

/** 1日分の予定。メモが空のときは memo を付けない */
export const DayEntrySchema = v.pipe(
  v.strictObject({ s: StatusSchema, memo: v.optional(Memo) }),
  v.transform(({ s, memo }) => (memo ? { s, memo } : { s })),
);

/** 予定の更新。null は「未入力に戻す」 */
export const AvailabilityUpdate = v.strictObject({
  availability: v.pipe(
    v.record(DateString, v.nullable(DayEntrySchema)),
    v.check(
      (obj) => Object.keys(obj).length <= LIMITS.availabilityPerRequest,
      `一度に保存できるのは${LIMITS.availabilityPerRequest}日分までです`,
    ),
  ),
});

export const CreateCalendar = v.strictObject({ displayName: DisplayName });
export const PatchCalendar = v.strictObject({ displayName: DisplayName });

export const ReissueSecret = v.strictObject({
  newSecret: v.pipe(v.string(), v.regex(ID_PATTERNS.secret, "新しい秘密の形が正しくありません")),
});

export const CreateShareToken = v.strictObject({
  ttlSeconds: v.optional(
    v.pipe(
      v.number(),
      v.integer("秒数は整数で指定してください"),
      v.minValue(ShareTokenTtl.min, `有効期限は${ShareTokenTtl.min}秒以上です`),
      v.maxValue(ShareTokenTtl.max, `有効期限は${ShareTokenTtl.max}秒以下です`),
    ),
  ),
});

// ---- 卓(spec.md 5.6) ----

/** 卓のタイトル */
export const Title = v.pipe(
  v.string(),
  v.transform(cleanSingleLine),
  v.minGraphemes(1, "タイトルを入れてください"),
  v.maxGraphemes(LIMITS.title, `タイトルは${LIMITS.title}文字までです`),
);

/** 候補日。重複は不可。並びは問わない(サーバーで日付順にする) */
export const CandidateDates = v.pipe(
  v.array(DateString),
  v.minLength(1, "候補日を1日以上選んでください"),
  v.maxLength(LIMITS.candidateDates, `候補日は${LIMITS.candidateDates}日までです`),
  v.check((dates) => new Set(dates).size === dates.length, "同じ候補日が重なっています"),
);

export const CreateSession = v.strictObject({
  title: Title,
  candidateDates: CandidateDates,
  displayName: v.optional(DisplayName),
});

export const PatchSession = v.strictObject({
  title: v.optional(Title),
  candidateDates: v.optional(CandidateDates),
  confirmedDate: v.optional(v.nullable(DateString)),
});

export const JoinSession = v.strictObject({
  shareToken: v.optional(
    v.pipe(v.string(), v.regex(ID_PATTERNS.shareToken, "参加用のトークンの形が正しくありません")),
  ),
  displayName: v.optional(DisplayName),
});

export const PatchParticipant = v.strictObject({
  role: v.optional(v.picklist(["GM", "PL"], "役割は GM か PL です")),
  displayName: v.optional(v.nullable(DisplayName)),
});
