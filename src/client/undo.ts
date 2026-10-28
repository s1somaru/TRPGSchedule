// 自分のカレンダーの「元に戻す」「やり直す」(spec.md 6.3 ③)。
// preact に頼らない計算だけを置く(テストしやすくするため)。
//
// 1回の操作(1日のタップ・長押しでなぞった1回・メモの保存)を1つの「手順」として覚える。
// 手順には、変えた日ごとに「変える前」と「変えた後」を持つ。
// 元に戻すと「変える前」を、やり直すと「変えた後」を、いつもの自動保存に渡す。
// 覚えるのはこの画面を開いている間だけ(閉じたら消える)。
import { sameDayTime } from "../shared/time";
import type { DayEntry } from "../shared/types";

/** 1日分の変更。null は「入っていない」 */
interface DayChange {
  before: DayEntry | null;
  after: DayEntry | null;
}

/** 1回の操作で変えた日。op は操作の番号(同じ番号の変更を1つの手順にまとめる) */
export interface UndoStep {
  op: number;
  days: Record<string, DayChange>;
}

export interface UndoHistory {
  /** 元に戻せる手順(古い順) */
  done: UndoStep[];
  /** やり直せる手順(元に戻した新しい順が後ろ) */
  undone: UndoStep[];
}

/** 覚えておく手順の数 */
export const UNDO_LIMIT = 50;

export const emptyHistory = (): UndoHistory => ({ done: [], undone: [] });

/** 1日分の中身が同じか(記号・時刻・メモ) */
function sameEntry(a: DayEntry | null, b: DayEntry | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.s === b.s &&
    (a.memo ?? "") === (b.memo ?? "") &&
    sameDayTime(a.time, b.time)
  );
}

/**
 * 1日分の変更を覚える。
 * op は操作の番号。直前の手順と同じ番号なら、その手順に足す(長押しでなぞっている途中)。
 * 同じ日をもう一度変えたら、最初の「変える前」を残す。結果として中身が変わらない日は覚えない。
 * 新しく変えたら、やり直せる手順は消す。
 */
export function recordChange(
  history: UndoHistory,
  op: number,
  date: string,
  before: DayEntry | null,
  after: DayEntry | null,
): UndoHistory {
  const last = history.done[history.done.length - 1];
  const merge = last !== undefined && last.op === op;
  const origin = merge && last.days[date] ? last.days[date].before : before;
  const days = merge ? { ...last.days } : {};
  if (sameEntry(origin, after)) {
    // 変わらない変更は覚えない(なぞっている途中で元に戻った日は、手順から外す)
    if (!(date in days)) return history;
    delete days[date];
  } else {
    days[date] = { before: origin, after };
  }
  const kept = merge ? history.done.slice(0, -1) : history.done;
  const done = Object.keys(days).length > 0 ? [...kept, { op, days }] : kept;
  return { done: done.slice(-UNDO_LIMIT), undone: [] };
}

/** 元に戻す。戻すときに自動保存へ渡す変更も返す。戻せないときは null */
export function undo(history: UndoHistory): { history: UndoHistory; changes: Record<string, DayEntry | null> } | null {
  const step = history.done[history.done.length - 1];
  if (!step) return null;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, step] },
    changes: Object.fromEntries(Object.entries(step.days).map(([date, c]) => [date, c.before])),
  };
}

/** やり直す。やり直せないときは null */
export function redo(history: UndoHistory): { history: UndoHistory; changes: Record<string, DayEntry | null> } | null {
  const step = history.undone[history.undone.length - 1];
  if (!step) return null;
  return {
    history: { done: [...history.done, step], undone: history.undone.slice(0, -1) },
    changes: Object.fromEntries(Object.entries(step.days).map(([date, c]) => [date, c.after])),
  };
}
