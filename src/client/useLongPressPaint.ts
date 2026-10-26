// 日付のマス目で「タップ」と「長押ししてなぞる」を見分ける共通の部品。
// 自分のカレンダー(CalendarGrid)と、候補日の選び方(DatePicker)で使う。
// - タップ:1日だけ操作する
// - 長押ししてから指をなぞる:なぞった日にまとめて操作する
// - 長押しになる前に指が動いたら、ふつうのスクロールとして扱う
import { useEffect, useRef } from "preact/hooks";

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 10;

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  date: string;
  /** メモの印を押したか(自分のカレンダーで使う) */
  memoDot: boolean;
  timer: number | null;
  painting: boolean;
  painted: Set<string>;
}

export interface LongPressPaintOptions {
  /** 長押しでなぞる操作を使えるか */
  canPaint: boolean;
  /** 1日をタップしたとき */
  onTap: (date: string, memoDot: boolean) => void;
  /** なぞっている途中で、新しい日に触れたとき。first はなぞり始めの日のとき true */
  onPaint: (date: string, first: boolean) => void;
}

/** 指の下にある「押せる日」 */
function dateUnder(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-date]");
  return el && !el.disabled ? el.dataset.date! : null;
}

/**
 * マス目の入れ物に付ける ref と、指やマウスの処理を返す。
 * マスには data-date を付け、押せない日は disabled にしておくこと
 */
export function useLongPressPaint(opts: LongPressPaintOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // なぞっている間は、画面のスクロールを止める(この処理は passive: false が必要なので手で登録する)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.painting) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const end = () => {
    const g = gesture.current;
    if (g?.timer) clearTimeout(g.timer);
    gesture.current = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as Element;
    const cell = target.closest<HTMLButtonElement>("[data-date]");
    if (!cell || cell.disabled) return;
    end();
    const g: Gesture = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      date: cell.dataset.date!,
      memoDot: target.closest("[data-memo-dot]") !== null,
      timer: null,
      painting: false,
      painted: new Set(),
    };
    if (optsRef.current.canPaint && !g.memoDot) {
      g.timer = window.setTimeout(() => {
        g.timer = null;
        g.painting = true;
        g.painted.add(g.date);
        optsRef.current.onPaint(g.date, true);
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.painting) {
      // 長押しになる前に動いたら、スクロールのつもりとみなしてやめる
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > MOVE_TOLERANCE_PX) end();
      return;
    }
    const date = dateUnder(e.clientX, e.clientY);
    if (date && !g.painted.has(date)) {
      g.painted.add(date);
      optsRef.current.onPaint(date, false);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.painting) optsRef.current.onTap(g.date, g.memoDot);
    end();
  };

  return {
    ref: containerRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: end,
      onContextMenu: (e: Event) => e.preventDefault(),
    },
  };
}
