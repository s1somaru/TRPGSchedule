// 月表示のカレンダー(spec.md 6.3 ③)。
// タップで1日ずつ付ける。長押ししてから指をなぞると、なぞった日にまとめて付く
// (すぐなぞった場合は、ふつうのスクロールとして扱う)
import { useEffect, useRef } from "preact/hooks";
import { addDays } from "../../shared/dates";
import type { Availability } from "../../shared/types";
import { dateLabel, STATUS_LABEL, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 10;

interface Props {
  availability: Availability;
  range: { from: string; to: string };
  today: string;
  /** 長押しでなぞる操作を使えるか(メモのペンのときは使えない) */
  canPaint: boolean;
  /** 1日をタップしたとき。memoDot はメモの印を押したとき */
  onTap: (date: string, memoDot: boolean) => void;
  /** なぞっている途中で、新しい日に触れたとき */
  onPaint: (date: string) => void;
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  date: string;
  memoDot: boolean;
  timer: number | null;
  painting: boolean;
  painted: Set<string>;
}

/** 表示する月(今月〜入力できる最後の日の月) */
function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    out.push({ year: y, month: m });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 指の下にある「押せる日」 */
function dateUnder(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-date]");
  return el && !el.disabled ? el.dataset.date! : null;
}

export function CalendarGrid(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

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
    if (propsRef.current.canPaint && !g.memoDot) {
      g.timer = window.setTimeout(() => {
        g.timer = null;
        g.painting = true;
        g.painted.add(g.date);
        propsRef.current.onPaint(g.date);
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
      propsRef.current.onPaint(date);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.painting) propsRef.current.onTap(g.date, g.memoDot);
    end();
  };

  const months = monthsBetween(props.today, props.range.to);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {months.map(({ year, month }) => {
        const first = `${year}-${pad(month)}-01`;
        const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const blanks = weekdayOf(first);
        return (
          <section class="month" key={first} aria-label={`${year}年${month}月`}>
            <h3>
              {year}年{month}月
            </h3>
            <div class="grid">
              {[0, 1, 2, 3, 4, 5, 6].map((w) => (
                <div class={`wd ${w === 0 ? "sun" : w === 6 ? "sat" : ""}`} key={`w${w}`} aria-hidden="true">
                  {weekdayLabel(w)}
                </div>
              ))}
              {Array.from({ length: blanks }, (_, i) => (
                <div class="day empty" key={`b${i}`} aria-hidden="true" />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = addDays(first, i);
                const entry = props.availability[date];
                const wd = weekdayOf(date);
                const disabled = date < props.range.from || date > props.range.to;
                const classes = [
                  "day",
                  entry ? `s-${entry.s}` : "",
                  wd === 0 ? "sun" : wd === 6 ? "sat" : "",
                  date === props.today ? "today" : "",
                ].join(" ");
                const label = `${dateLabel(date)} ${entry ? STATUS_LABEL[entry.s] : "未入力"}${entry?.memo ? "、メモあり" : ""}`;
                return (
                  <button
                    type="button"
                    class={classes}
                    key={date}
                    data-date={date}
                    disabled={disabled}
                    aria-label={label}
                    onClick={(e) => {
                      // キーボードで押したとき(指やマウスは上の処理で扱う)
                      if (e.detail === 0) props.onTap(date, false);
                    }}
                  >
                    <span class="num">{i + 1}</span>
                    <span class="sym" aria-hidden="true">
                      {entry ? STATUS_SYMBOL[entry.s] : ""}
                    </span>
                    {entry?.memo && (
                      <span class="memo-dot" data-memo-dot aria-hidden="true">
                        メモ
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
