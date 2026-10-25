// 画面に出す文字の形をそろえる
import type { Status } from "../shared/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 曜日(0 = 日曜) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const weekdayLabel = (i: number) => WEEKDAYS[i]!;

/** 「11月3日(火)」 */
export function dateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日(${weekdayLabel(weekdayOf(date))})`;
}

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
