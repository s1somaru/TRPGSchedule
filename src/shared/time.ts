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
 * 1日分の空いている時間。1つ、または複数(第2段階で書けるようにする)。
 * 読むところは必ず rangesOf を通す
 */
export type DayTime = TimeRange | TimeRange[];

/** 空いている時間を区間の一覧にする(なし → []) */
export function rangesOf(time: DayTime | null | undefined): TimeRange[] {
  if (!time) return [];
  return Array.isArray(time) ? time : [time];
}

/** 表示用。「10:00〜13:00、18:00〜24:00」 */
export function dayTimeLabel(time: DayTime): string {
  return rangesOf(time).map(rangeLabel).join("、");
}

/** マス目用。最初の区間の短い表示と、ほかの区間の数(「10〜13 +1」) */
export function shortDayTimeLabel(time: DayTime): string {
  const ranges = rangesOf(time);
  if (ranges.length === 0) return "";
  return ranges.length > 1 ? `${shortRangeLabel(ranges[0]!)} +${ranges.length - 1}` : shortRangeLabel(ranges[0]!);
}

/** 2つの時刻の並びが同じか(元に戻すの比較などで使う) */
export function sameDayTime(a: DayTime | null | undefined, b: DayTime | null | undefined): boolean {
  const x = rangesOf(a);
  const y = rangesOf(b);
  return x.length === y.length && x.every((r, i) => r.from === y[i]!.from && r.to === y[i]!.to);
}

// ---- 区間の計算(分。半開区間 [始まり, 終わり)。終わりなしは 30:00 まで) ----

type Span = readonly [number, number];

const DAY_SPAN: Span = [toMinutes(DAY_START), toMinutes(DAY_END)];

function spanOf(r: TimeRange): Span {
  return [toMinutes(r.from), r.to ? toMinutes(r.to) : DAY_SPAN[1]];
}

/** 並べて、重なる・接する区間をまとめる */
function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** 共通部分 */
function intersect(xs: Span[], ys: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of xs) {
    for (const [c, d] of ys) {
      const lo = Math.max(a, c);
      const hi = Math.min(b, d);
      if (hi > lo) out.push([lo, hi]);
    }
  }
  return union(out);
}

/** xs から ys を引く */
function subtract(xs: Span[], ys: Span[]): Span[] {
  let rest = union(xs);
  for (const [c, d] of union(ys)) {
    const next: Span[] = [];
    for (const [a, b] of rest) {
      if (d <= a || c >= b) next.push([a, b]);
      else {
        if (c > a) next.push([a, c]);
        if (d < b) next.push([d, b]);
      }
    }
    rest = next;
  }
  return rest;
}

/** 空き区間 F と卓の時間帯 W から記号を決める(W は必ずある) */
function judgeSpans(status: Status, free: Span[], w: Span): { s: Status; adjusted: boolean } {
  // 全部含む(始まりに間に合い、終わりまでいられる)
  if (free.some(([a, b]) => a <= w[0] && b >= w[1])) return { s: status, adjusted: false };
  // 重ならない(本人が卓の前に帰る、または卓が終わってから来る)
  if (intersect(free, [w]).length === 0) return { s: "x", adjusted: true };
  // 一部だけ重なる
  return { s: "t", adjusted: status !== "t" };
}

/**
 * 卓の時間帯と、本人の空いている時間を照らし合わせて、その卓での記号を決める(spec.md 3.18)
 * - × はそのまま ×
 * - 卓に時間帯がない、または本人が時刻を入れていない:記号のまま
 * - 本人の時間のどれか1つが卓の時間帯を全部含む:記号のまま
 * - 重ならない:×
 * - 一部だけ重なる:△
 * 終わりのない時間帯は 30:00(翌朝6時)までとして扱う。
 * adjusted は、時刻のせいで記号が変わったとき true
 */
export function statusForWindow(
  status: Status,
  time: DayTime | undefined,
  window: TimeRange | undefined,
): { s: Status; adjusted: boolean } {
  const ranges = rangesOf(time);
  if (status === "x" || ranges.length === 0 || !window) return { s: status, adjusted: false };
  return judgeSpans(status, union(ranges.map(spanOf)), spanOf(window));
}

const RANK: Record<Status, number> = { o: 2, t: 1, x: 0 };

/**
 * ほかの卓の開催日(busy)も入れて、その卓での記号を決める(design/busy-and-multi-times.md 2.2)。
 * サーバーだけが呼ぶ。busy の各要素は、その日のほかの卓の時間帯(null は時刻不明)。
 * status が null は未入力。
 * busy は「この日のこの時間に、別の卓の予定が重なっている」とき true。
 * 結果は busy なしの判定より良くならない。
 */
export function statusWithBusy(
  status: Status | null,
  time: DayTime | undefined,
  window: TimeRange | undefined,
  busy: (TimeRange | null)[],
): { s: Status | null; adjusted: boolean; busy: boolean } {
  const base = status ? statusForWindow(status, time, window) : null;
  const plain = { s: base?.s ?? null, adjusted: base?.adjusted ?? false, busy: false };
  if (status === "x" || busy.length === 0) return plain;

  const ranges = rangesOf(time);
  const free = status && ranges.length > 0 ? union(ranges.map(spanOf)) : [DAY_SPAN];
  const w = window ? spanOf(window) : undefined;
  const relevant = w ? intersect(free, [w]) : free;
  if (relevant.length === 0) return plain;

  const unknown = busy.some((b) => b === null);
  const taken = union(busy.filter((b): b is TimeRange => b !== null).map(spanOf));
  if (!unknown && intersect(relevant, taken).length === 0) return plain;

  // ここから先は「重なっている」
  if (!status || !base) return { s: null, adjusted: false, busy: true };
  const left = subtract(free, taken);
  let s: Status;
  if (left.length === 0) s = "x";
  else if (unknown || !w) s = "t";
  else s = judgeSpans(status, left, w).s;
  // busy なしの判定より良くはしない
  if (RANK[s] > RANK[base.s]) s = base.s;
  return { s, adjusted: base.adjusted, busy: true };
}
