// 入力チェックの定義(spec.md 5.7)。サーバーと画面で同じものを使う
import * as v from "valibot";
import { isValidDate } from "./dates";
import { ID_PATTERNS } from "./ids";
import { FEEDBACK_LIMITS, LIMITS, RAW_LIMITS } from "./limits";
import { cleanMultiLine, cleanSingleLine } from "./text";

export { LIMITS };


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
  v.maxLength(RAW_LIMITS.displayName, "名前が長すぎます"),
);

/** メモ。空なら「メモなし」として扱う */
export const Memo = v.pipe(
  v.string(),
  v.transform(cleanMultiLine),
  v.maxGraphemes(LIMITS.memo, `メモは${LIMITS.memo}文字までです`),
  v.maxLength(RAW_LIMITS.memo, "メモが長すぎます"),
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


// ---- 卓(spec.md 5.6) ----

/** 卓のタイトル */
export const Title = v.pipe(
  v.string(),
  v.transform(cleanSingleLine),
  v.minGraphemes(1, "タイトルを入れてください"),
  v.maxGraphemes(LIMITS.title, `タイトルは${LIMITS.title}文字までです`),
  v.maxLength(RAW_LIMITS.title, "タイトルが長すぎます"),
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
  /** 開催日。毎回リストをまるごと送る。空なら未確定に戻す */
  confirmedDates: v.optional(
    v.pipe(
      v.array(DateString),
      v.maxLength(LIMITS.candidateDates, `開催日は${LIMITS.candidateDates}日までです`),
      v.check((dates) => new Set(dates).size === dates.length, "同じ開催日が重なっています"),
    ),
  ),
});

export const JoinSession = v.strictObject({
  displayName: v.optional(DisplayName),
});

export const PatchParticipant = v.strictObject({
  role: v.optional(v.picklist(["GM", "PL"], "役割は GM か PL です")),
  displayName: v.optional(v.nullable(DisplayName)),
});

// ---- 問い合わせ・評価(spec.md 3.17) ----

/** どの画面から送ったか(ID は入れない) */
export const FeedbackPage = v.picklist(["/", "/c", "/s", "/new", "/contact", "/terms", "/privacy"]);

const longText = (max: number, label: string) =>
  v.pipe(
    v.string(),
    v.transform(cleanMultiLine),
    v.maxGraphemes(max, `${label}は${max}文字までです`),
    v.maxLength(max * 4, `${label}が長すぎます`),
  );

export const RatingFeedback = v.strictObject({
  kind: v.literal("rating"),
  rating: v.pipe(v.number(), v.integer(), v.minValue(1, "★は1〜5で選んでください"), v.maxValue(5, "★は1〜5で選んでください")),
  message: v.optional(longText(FEEDBACK_LIMITS.ratingMessage, "ひとこと")),
  page: v.optional(FeedbackPage),
});

export const ContactFeedback = v.strictObject({
  kind: v.literal("contact"),
  category: v.picklist(["bug", "request", "question", "other"], "種類を選んでください"),
  message: v.pipe(longText(FEEDBACK_LIMITS.contactMessage, "内容"), v.minLength(1, "内容を入れてください")),
  contact: v.optional(
    v.pipe(
      v.string(),
      v.transform(cleanSingleLine),
      v.maxGraphemes(FEEDBACK_LIMITS.replyTo, `返信先は${FEEDBACK_LIMITS.replyTo}文字までです`),
      v.maxLength(FEEDBACK_LIMITS.replyTo * 4, "返信先が長すぎます"),
    ),
  ),
  page: v.optional(FeedbackPage),
});

export const FeedbackBody = v.variant("kind", [RatingFeedback, ContactFeedback], "送る内容の種類が正しくありません");
