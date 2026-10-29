// 入力チェックの定義(spec.md 5.7)。サーバーと画面で同じものを使う
import * as v from "valibot";
import { isValidDate } from "./dates";
import { ID_PATTERNS } from "./ids";
import { FEEDBACK_LIMITS, LIMITS, RAW_LIMITS } from "./limits";
import { cleanMultiLine, cleanSingleLine } from "./text";
import { isValidRange, normalizeDayTime, type DayTime, type TimeRange } from "./time";

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

/** 時間帯(06:00〜30:00、30分刻み、始まり < 終わり。終わりは省略できる) */
export const TimeRangeSchema = v.pipe(
  v.strictObject({ from: v.string(), to: v.optional(v.string()) }),
  v.check(isValidRange, "時刻は 6:00〜翌6:00 の30分刻みで、始まりより後に終わるように選んでください"),
  v.transform(({ from, to }) => (to ? { from, to } : { from })),
);

/** 本人の空いている時間の数の上限(1日あたり) */
export const MAX_DAY_RANGES = 3;

const DayTimeArraySchema = v.pipe(
  v.array(TimeRangeSchema),
  v.minLength(1, "空いている時間を1つ以上選んでください"),
  v.maxLength(MAX_DAY_RANGES, `空いている時間は1日に${MAX_DAY_RANGES}つまでです`),
  v.transform((ranges: TimeRange[]): DayTime => normalizeDayTime(ranges)),
);
/**
 * 本人の空いている時間(design/busy-and-multi-times.md 3.1)。
 * 時間帯1つ(今までの形のまま通る)、または1〜3個の配列(並べてまとめた形で保存する)
 * union だと時刻の誤り(422)が形の誤り(400)にまとめられるので、送られた形で分ける
 */
export const DayTimeSchema = v.lazy((input) => (Array.isArray(input) ? DayTimeArraySchema : TimeRangeSchema));

/** 1日分の予定。メモが空のときは memo を付けない。× の日には時刻を付けない */
export const DayEntrySchema = v.pipe(
  v.strictObject({ s: StatusSchema, memo: v.optional(Memo), time: v.optional(DayTimeSchema) }),
  v.transform(({ s, memo, time }) => ({
    s,
    ...(memo ? { memo } : {}),
    ...(time && s !== "x" ? { time } : {}),
  })),
);

/** 曜日ごとの「いつもの時間」。毎回まるごと送る(ない曜日は「なし」) */
export const WeeklyTimesSchema = v.record(
  v.picklist(["0", "1", "2", "3", "4", "5", "6"], "曜日の指定が正しくありません"),
  DayTimeSchema,
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
export const PatchCalendar = v.pipe(
  v.strictObject({ displayName: v.optional(DisplayName), weeklyTimes: v.optional(WeeklyTimesSchema) }),
  v.check((b) => b.displayName !== undefined || b.weeklyTimes !== undefined, "変える内容がありません"),
);

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
  /** 卓の時間帯(任意) */
  timeWindow: v.optional(TimeRangeSchema),
});

export const PatchSession = v.pipe(
  v.strictObject({
    title: v.optional(Title),
    /** 卓の時間帯。null で外す */
    timeWindow: v.optional(v.nullable(TimeRangeSchema)),
    /** 日ごとの時間帯。毎回まるごと送る(候補日でない日は捨てる) */
    dateTimes: v.optional(v.record(DateString, TimeRangeSchema)),
    candidateDates: v.optional(CandidateDates),
    /** 開催日。毎回リストをまるごと送る。空なら未確定に戻す */
    confirmedDates: v.optional(
      v.pipe(
        v.array(DateString),
        v.maxLength(LIMITS.candidateDates, `開催日は${LIMITS.candidateDates}日までです`),
        v.check((dates) => new Set(dates).size === dates.length, "同じ開催日が重なっています"),
      ),
    ),
  }),
  v.check((b) => Object.values(b).some((x) => x !== undefined), "変える内容がありません"),
);

export const JoinSession = v.strictObject({
  displayName: v.optional(DisplayName),
});

export const PatchParticipant = v.pipe(
  v.strictObject({
    role: v.optional(v.picklist(["GM", "PL"], "役割は GM か PL です")),
    displayName: v.optional(v.nullable(DisplayName)),
  }),
  v.check((b) => b.role !== undefined || b.displayName !== undefined, "変える内容がありません"),
);

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
