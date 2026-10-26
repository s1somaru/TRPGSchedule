// 画面で使う計算だけの部分。画面の部品やブラウザの機能に頼らないので、そのままテストできる
import { addDays } from "../shared/dates";
import { ID_PATTERNS } from "../shared/ids";
import type { TimeRange } from "../shared/time";
import type { Availability, DayEntry, Status } from "../shared/types";
import { weekdayOf } from "./format";

/** 貼り付けられた編集URLから、カレンダーIDと秘密を取り出す。形が違えば null */
export function parseEditUrl(text: string): { id: string; secret: string } | null {
  try {
    const url = new URL(text.trim());
    const id = /^\/c\/([^/]+)$/.exec(url.pathname)?.[1];
    const secret = url.hash.slice(1);
    if (id && ID_PATTERNS.calendar.test(id) && ID_PATTERNS.secret.test(secret)) return { id, secret };
  } catch {
    // URL の形でなければ null
  }
  return null;
}

/** 予定に変更を当てはめる(null の日は未入力に戻す) */
export function applyChanges(base: Availability, changes: Record<string, DayEntry | null>): Availability {
  const next = { ...base };
  for (const [date, entry] of Object.entries(changes)) {
    if (entry) next[date] = entry;
    else delete next[date];
  }
  return next;
}

/** from の月から to の月までの、年と月の一覧 */
export function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  const out: { year: number; month: number }[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    out.push({ year: y, month: m });
  }
  return out;
}

/** from から to までの日付(両端を含む) */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- 候補日の選び方(spec.md 6.3 ④) ----

export const ALL_DAYS = [true, true, true, true, true, true, true];

export interface PickerState {
  period: { from: string; to: string } | null;
  /** 曜日ごとのオン・オフ(0 = 日曜) */
  weekdays: boolean[];
  /** 期間とは別に足した日 */
  extras: string[];
  /** 期間の中から外した日 */
  removed: string[];
}

/** 今の状態から、選ばれている日を出す(日付順) */
export function computePicked(s: PickerState): string[] {
  const set = new Set<string>();
  if (s.period) {
    for (const d of daysBetween(s.period.from, s.period.to)) {
      if (s.weekdays[weekdayOf(d)] && !s.removed.includes(d)) set.add(d);
    }
  }
  for (const d of s.extras) set.add(d);
  return [...set].sort();
}

/** 1日をタップしたときの次の状態(選ばれていれば外し、なければ足す) */
export function toggleDay(s: PickerState, date: string): PickerState {
  const inPeriod =
    s.period !== null && date >= s.period.from && date <= s.period.to && Boolean(s.weekdays[weekdayOf(date)]);
  if (computePicked(s).includes(date)) {
    return {
      ...s,
      extras: s.extras.filter((d) => d !== date),
      removed: inPeriod ? [...s.removed, date] : s.removed,
    };
  }
  return {
    ...s,
    removed: s.removed.filter((d) => d !== date),
    extras: inPeriod ? s.extras : [...s.extras, date],
  };
}

/**
 * 1日を「選んだ状態」または「外した状態」にする(長押ししてなぞるときに使う)。
 * すでにその状態なら、何も変えない
 */
export function setDayPicked(s: PickerState, date: string, picked: boolean): PickerState {
  return computePicked(s).includes(date) === picked ? s : toggleDay(s, date);
}

// ---- スタンプ(spec.md 3.19) ----

/**
 * スタンプの中身。項目ごとに「変えない(undefined)」「これにする」「消す(null)」を選べる
 * - s:記号(消すことはできない)
 * - time:空いている時間
 * - memo:メモ
 */
export interface Stamp {
  s?: Status;
  time?: TimeRange | null;
  memo?: string | null;
}

/**
 * 1日にスタンプを当てはめた結果。記号が決まらない(記号のない日に「記号は変えない」スタンプ)ときは undefined(その日は変えない)。
 * × の日には時刻を付けない
 */
export function applyStamp(current: DayEntry | undefined, stamp: Stamp): DayEntry | undefined {
  const s = stamp.s ?? current?.s;
  if (!s) return undefined;
  const time = stamp.time === undefined ? current?.time : (stamp.time ?? undefined);
  const memo = stamp.memo === undefined ? current?.memo : (stamp.memo ?? undefined);
  return {
    s,
    ...(memo ? { memo } : {}),
    ...(time && s !== "x" ? { time } : {}),
  };
}

/** その日の内容を、まるごと写すスタンプにする */
export function stampFromEntry(entry: DayEntry): Stamp {
  return { s: entry.s, time: entry.time ?? null, memo: entry.memo ?? null };
}

/** スタンプが何も変えない(全部「変えない」)か */
export function isEmptyStamp(stamp: Stamp): boolean {
  return stamp.s === undefined && stamp.time === undefined && stamp.memo === undefined;
}
