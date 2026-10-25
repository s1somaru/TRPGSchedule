// 日付の計算。「今日」は常に日本時間で決める(spec.md 5.1)
// 日付は "YYYY-MM-DD" の文字列で扱う。日本には夏時間がないので、9時間ずらすだけで日本時間になる

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 入力できる期間の長さ(今日から何か月先まで) */
export const INPUT_MONTHS_AHEAD = 6;
/** 過去の予定を何日分残すか */
export const PAST_DAYS_KEPT = 90;
/** 日付が変わってから何分間は、前日も受け付けるか */
export const MIDNIGHT_GRACE_MINUTES = 10;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" の形で、実在する日付かどうか */
export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toUtcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function format(t: Date): string {
  return t.toISOString().slice(0, 10);
}

/** 日本時間での今日の日付と、0時からの経過分 */
export function jstNow(now: Date = new Date()): { today: string; minutes: number } {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    today: format(shifted),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 日付に n 日足す(マイナスなら引く) */
export function addDays(date: string, n: number): string {
  return format(new Date(toUtcDate(date).getTime() + n * DAY_MS));
}

/** 日付に n か月足す。行き先の月にその日がなければ月末にそろえる(8/31 + 6か月 → 2/28) */
export function addMonths(date: string, n: number): string {
  const t = toUtcDate(date);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return format(new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), lastDay))));
}

/** 画面に見せる「入力できる期間」 */
export function inputRange(now: Date = new Date()): { from: string; to: string } {
  const { today } = jstNow(now);
  return { from: today, to: addMonths(today, INPUT_MONTHS_AHEAD) };
}

/**
 * サーバーが実際に受け付ける期間。
 * 日付が変わった直後は、端末の時計とのずれを吸収するため前日も受け付ける
 */
export function acceptedRange(now: Date = new Date()): { from: string; to: string } {
  const { today, minutes } = jstNow(now);
  const from = minutes < MIDNIGHT_GRACE_MINUTES ? addDays(today, -1) : today;
  return { from, to: addMonths(today, INPUT_MONTHS_AHEAD) };
}

/** これより前の日の予定は捨てる */
export function pastCutoff(now: Date = new Date()): string {
  return addDays(jstNow(now).today, -PAST_DAYS_KEPT);
}
