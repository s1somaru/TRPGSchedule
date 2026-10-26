// 月表示のカレンダー(spec.md 6.3 ③)。
// タップで1日ずつ付ける。長押ししてから指をなぞると、なぞった日にまとめて付く
// (すぐなぞった場合は、ふつうのスクロールとして扱う)
import { addDays } from "../../shared/dates";
import type { Availability } from "../../shared/types";
import { monthsBetween } from "../logic";
import { rangeLabel, shortRangeLabel } from "../../shared/time";
import { useLongPressPaint } from "../useLongPressPaint";
import { dateLabel, STATUS_LABEL, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";

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

const pad = (n: number) => String(n).padStart(2, "0");

export function CalendarGrid(props: Props) {
  // タップと「長押ししてなぞる」の見分けは、共通の部品に任せる
  const paint = useLongPressPaint({
    canPaint: props.canPaint,
    onTap: props.onTap,
    onPaint: (date) => props.onPaint(date),
  });

  const months = monthsBetween(props.today, props.range.to);

  return (
    <div ref={paint.ref} class="months" {...paint.handlers}>
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
                const label = `${dateLabel(date)} ${entry ? STATUS_LABEL[entry.s] : "未入力"}${entry?.time ? `、${rangeLabel(entry.time)}` : ""}${entry?.memo ? "、メモあり" : ""}`;
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
                    {entry?.time && (
                      <span class="cell-time" aria-hidden="true">
                        {shortRangeLabel(entry.time)}
                      </span>
                    )}
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
