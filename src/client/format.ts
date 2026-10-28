// 画面に出す文字の形をそろえる
import { holidayName } from "../shared/holidays";
import { rangeLabel } from "../shared/time";
import type { BusyCell, Status } from "../shared/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 曜日(0 = 日曜) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const weekdayLabel = (i: number) => WEEKDAYS[i]!;

/** 「11月3日(火)」。祝日は「11月3日(火・祝)」 */
export function dateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日(${weekdayLabel(weekdayOf(date))}${holidayName(date) ? "・祝" : ""})`;
}

/** 日付の色分け。日曜と祝日は赤(sun)、土曜は青(sat) */
export function dayColorClass(date: string): string {
  const wd = weekdayOf(date);
  if (wd === 0 || holidayName(date)) return "sun";
  return wd === 6 ? "sat" : "";
}

export { holidayName };

/** 「11/3」 */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** 「3日前」のような表示 */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

export const STATUS_SYMBOL: Record<Status, string> = { o: "◯", t: "△", x: "×" };
export const STATUS_LABEL: Record<Status, string> = { o: "参加できる", t: "たぶん参加できる", x: "参加できない" };

/** 見た目の文字数(絵文字なども1文字と数える) */
export function graphemeLength(text: string): number {
  return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].length;
}

/**
 * 開催日の一覧を短く表す。次の開催日(なければ最後の開催日)と、ほかの日数。
 * 例:「11/14 開催(ほか2日)」
 */
export function confirmedSummary(dates: string[], today: string): string {
  const next = dates.find((d) => d >= today) ?? dates[dates.length - 1];
  if (!next) return "";
  const others = dates.length - 1;
  return `${shortDate(next)} 開催${others > 0 ? `(ほか${others}日)` : ""}`;
}

/**
 * ほかの卓の予定と重なっていることの説明(design/busy-and-multi-times.md 2.10)。
 * 本人には卓の名前と時刻、GM には重なっている時間、ほかの人には「入っています」だけ
 */
export function busyLabel(cell: BusyCell): string {
  if (cell.sessions) {
    const list = cell.sessions.map((s) => `「${s.title}」(${s.time ? rangeLabel(s.time) : "時間帯なし"})`).join("、");
    return `${list}と重なっています`;
  }
  if (cell.overlap === null) return "別の卓の予定と重なっています(時間帯は不明)";
  if (cell.overlap) return `${cell.overlap.map(rangeLabel).join("、")} が別の卓の予定と重なっています`;
  return "別の卓の予定が入っています";
}
