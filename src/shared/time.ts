// 時刻の扱い(spec.md 3.18)。サーバーと画面で共有する
// - 1日は「朝6時〜翌朝6時」。深夜に及ぶ卓も、始まった日の予定として扱う
// - 時刻は "HH:MM"。06:00〜30:00(翌朝6:00)を 30分刻みで使う。24:00 以降は翌日の時刻
import type { Status } from "./types";

/** 時間帯。to は省略できる(例:「21:00〜」) */
export interface TimeRange {
  from: string;
  to?: string;
}

export const DAY_START = "06:00";
export const DAY_END = "30:00";
export const STEP_MINUTES = 30;

const TIME_RE = /^(\d{2}):(\d{2})$/;

/** "HH:MM" を分にする(形が違えば NaN) */
export function toMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 使える時刻か(06:00〜30:00、30分刻み) */
export function isValidTime(time: string): boolean {
  const min = toMinutes(time);
  return (
    Number.isInteger(min) &&
    min >= toMinutes(DAY_START) &&
    min <= toMinutes(DAY_END) &&
    min % STEP_MINUTES === 0
  );
}

/** 時間帯として正しいか(始まり < 終わり。始まりに 30:00 は使えない) */
export function isValidRange(r: TimeRange): boolean {
  if (!isValidTime(r.from) || r.from === DAY_END) return false;
  if (r.to === undefined) return true;
  return isValidTime(r.to) && toMinutes(r.to) > toMinutes(r.from);
}

/** 選べる時刻の一覧(始まり用は 30:00 を含めない) */
export function timeOptions(forEnd = false): string[] {
  const out: string[] = [];
  const end = toMinutes(DAY_END) - (forEnd ? 0 : STEP_MINUTES);
  const start = toMinutes(DAY_START) + (forEnd ? STEP_MINUTES : 0);
  for (let m = start; m <= end; m += STEP_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/** 表示用の時刻。ちょうど24時は「24:00」、それより後は「翌1:00」のように出す */
export function timeLabel(time: string): string {
  const min = toMinutes(time);
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, "0");
  if (min === 24 * 60) return "24:00";
  return h >= 24 ? `翌${h - 24}:${mm}` : `${h}:${mm}`;
}

/** 表示用の時間帯。「21:00〜24:00」「21:00〜」 */
export function rangeLabel(r: TimeRange): string {
  return `${timeLabel(r.from)}〜${r.to ? timeLabel(r.to) : ""}`;
}

/** マス目に出す短い時間帯。「21〜」「14〜18」「21:30〜」 */
export function shortRangeLabel(r: TimeRange): string {
  const short = (t: string) => {
    const min = toMinutes(t);
    const h = Math.floor(min / 60);
    return min % 60 === 0 ? `${h}` : `${h}:${String(min % 60).padStart(2, "0")}`;
  };
  return `${short(r.from)}〜${r.to ? short(r.to) : ""}`;
}

/**
 * 卓の時間帯と、本人の空いている時間を照らし合わせて、その卓での記号を決める(spec.md 3.18)
 * - × はそのまま ×
 * - 卓に時間帯がない、または本人が時刻を入れていない:記号のまま
 * - 本人の時間が卓の時間帯を全部含む:記号のまま
 * - 重ならない:×
 * - 一部だけ重なる:△
 * adjusted は、時刻のせいで記号が変わったとき true
 */
export function statusForWindow(
  status: Status,
  time: TimeRange | undefined,
  window: TimeRange | undefined,
): { s: Status; adjusted: boolean } {
  if (status === "x" || !time || !window) return { s: status, adjusted: false };
  const a = toMinutes(time.from);
  const b = time.to ? toMinutes(time.to) : Number.POSITIVE_INFINITY;
  const S = toMinutes(window.from);
  const E = window.to ? toMinutes(window.to) : Number.POSITIVE_INFINITY;

  // 重ならない(本人が卓の前に帰る、または卓が終わってから来る)
  if (b <= S || a >= E) return { s: "x", adjusted: true };
  // 全部含む(始まりに間に合い、終わりまでいられる)
  if (a <= S && b >= E) return { s: status, adjusted: false };
  // 一部だけ重なる
  return { s: "t", adjusted: status !== "t" };
}
