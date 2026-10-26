// 「開催できる日」の判定(spec.md 3.4)。卓ページの表示で使う
import { statusForWindow, type TimeRange } from "./time";
import type { ParticipantView, SessionResponse, Status } from "./types";

/**
 * ok      … GM全員が ◯ か △(開催できる日)
 * ng      … GMの誰かが ×(開催できない日。薄く表示する)
 * unknown … GMに未入力の人がいる、またはカレンダーが残っているGMがいない(判定できない日)
 */
export type DateJudgement = "ok" | "ng" | "unknown";

export interface DateSummary {
  date: string;
  judgement: DateJudgement;
  /** ◯ の人数 */
  o: number;
  /** △ の人数 */
  t: number;
  /** × の人数 */
  x: number;
  /** カレンダーが残っている参加者全員が ◯ */
  allOk: boolean;
}

/** カレンダーが残っているGMがいるか(いなければ「管理するGMがいません」と出す) */
export function hasActiveGm(participants: ParticipantView[]): boolean {
  return participants.some((p) => p.role === "GM" && !p.calendarDeleted);
}

/** その日の卓の時間帯(日ごとの時間帯があればそれ、なければ卓の時間帯) */
export function windowFor(session: Pick<SessionResponse, "timeWindow" | "dateTimes">, date: string): TimeRange | undefined {
  return session.dateTimes[date] ?? session.timeWindow ?? undefined;
}

/**
 * ある人のその日の、この卓での記号。時刻と卓の時間帯で判定する(spec.md 3.18)。
 * 未入力なら undefined。adjusted は時刻のせいで記号が変わったとき true
 */
export function cellStatus(
  p: ParticipantView,
  date: string,
  window?: TimeRange,
): { s: Status; adjusted: boolean } | undefined {
  const e = p.availability[date];
  return e ? statusForWindow(e.s, e.time, window) : undefined;
}

/** 1日分の判定と集計。window は卓の時間帯(あれば時刻で判定した記号で数える) */
export function judgeDate(participants: ParticipantView[], date: string, window?: TimeRange): DateSummary {
  // カレンダーが削除された人は、判定にも集計にも入れない
  const active = participants.filter((p) => !p.calendarDeleted);
  const gms = active.filter((p) => p.role === "GM");
  const statusOf = (p: ParticipantView) => cellStatus(p, date, window)?.s;

  let judgement: DateJudgement;
  if (gms.length === 0) judgement = "unknown";
  else if (gms.some((p) => statusOf(p) === "x")) judgement = "ng";
  else if (gms.every((p) => statusOf(p) === "o" || statusOf(p) === "t")) judgement = "ok";
  else judgement = "unknown";

  const count = (s: string) => active.filter((p) => statusOf(p) === s).length;
  return {
    date,
    judgement,
    o: count("o"),
    t: count("t"),
    x: count("x"),
    allOk: active.length > 0 && active.every((p) => statusOf(p) === "o"),
  };
}
