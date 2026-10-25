// 候補日の選び方(spec.md 6.3 ④)。連続した日も、飛び飛びの日も、少ない操作で選べるようにする
//   1. 期間を選ぶ(始まりと終わりをタップ。よく使う期間はボタンで)
//   2. 曜日でしぼる(例:土日だけ)
//   3. 1日ずつ足し引き(日をタップ)
import { useState } from "preact/hooks";
import { addDays, addMonths } from "../../shared/dates";
import { ALL_DAYS, computePicked as compute, monthsBetween, toggleDay, type PickerState as State } from "../logic";
import { LIMITS } from "../../shared/limits";
import type { Availability } from "../../shared/types";
import { dateLabel, shortDate, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";

interface Props {
  /** 最初から選ばれている日(候補日の変更のとき) */
  initial: string[];
  /** 選べる期間 */
  range: { from: string; to: string };
  today: string;
  /** 自分の予定(薄く重ねて見せる) */
  availability?: Availability;
  onChange: (dates: string[]) => void;
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (date: string) => addDays(addMonths(monthStart(date), 1), -1);

export function DatePicker(props: Props) {
  const [state, setState] = useState<State>({
    period: null,
    weekdays: ALL_DAYS,
    extras: props.initial,
    removed: [],
  });
  /** 期間の指定中:始まりの日を待っている("start")か、終わりの日を待っている(始まりの日) */
  const [picking, setPicking] = useState<null | "start" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = compute(state);

  /** 新しい状態にする。上限を超えるなら、変えずに理由を出す */
  const apply = (next: State) => {
    const dates = compute(next);
    if (dates.length > LIMITS.candidateDates) {
      setError(`候補日は${LIMITS.candidateDates}日までです(この操作だと${dates.length}日になります)`);
      return false;
    }
    setError(null);
    setState(next);
    props.onChange(dates);
    return true;
  };

  const clamp = (from: string, to: string) => ({
    from: from < props.range.from ? props.range.from : from,
    to: to > props.range.to ? props.range.to : to,
  });

  const setPeriod = (from: string, to: string) => {
    apply({ ...state, period: clamp(from, to), extras: [], removed: [] });
    setPicking(null);
  };

  const onDayTap = (date: string) => {
    if (picking === "start") {
      setPicking(date);
      setError(null);
      return;
    }
    if (picking) {
      const [from, to] = picking <= date ? [picking, date] : [date, picking];
      setPeriod(from, to);
      return;
    }
    // 1日ずつの足し引き
    apply(toggleDay(state, date));
  };

  const setWeekdays = (weekdays: boolean[]) => apply({ ...state, weekdays });
  const toggleWeekday = (i: number) => setWeekdays(state.weekdays.map((on, j) => (j === i ? !on : on)));

  /** 期間を取り消す(1日ずつ足した日は残す) */
  const clearPeriod = () => {
    apply({ ...state, period: null, removed: [] });
    setPicking(null);
  };

  const nextMonth = addMonths(monthStart(props.today), 1);
  // よく使う期間。選んでいるものをもう一度押すと取り消す
  const presets = [
    { label: "今月の残り", ...clamp(props.today, monthEnd(props.today)) },
    { label: "来月", ...clamp(nextMonth, monthEnd(nextMonth)) },
    { label: "これから2週間", ...clamp(props.today, addDays(props.today, 13)) },
  ];
  const isCurrent = (p: { from: string; to: string }) =>
    state.period !== null && state.period.from === p.from && state.period.to === p.to;
  const customPeriod = state.period !== null && !presets.some(isCurrent) ? state.period : null;

  // 曜日の近道。今の組み合わせと同じなら「押されている」。もう一度押すと全部の曜日に戻す
  const WEEKEND = [true, false, false, false, false, false, true];
  const WEEKDAYS_ONLY = [false, true, true, true, true, true, false];
  const sameDays = (a: boolean[]) => a.every((on, i) => on === state.weekdays[i]);
  const toggleShortcut = (pattern: boolean[]) => setWeekdays(sameDays(pattern) ? ALL_DAYS : pattern);

  return (
    <div class="stack picker">
      <div>
        <p class="step-title">1. 期間を選ぶ</p>
        <div class="chips">
          {presets.map((p) => (
            <button
              type="button"
              key={p.label}
              class="chip"
              aria-pressed={isCurrent(p)}
              onClick={() => (isCurrent(p) ? clearPeriod() : setPeriod(p.from, p.to))}
            >
              {p.label}
            </button>
          ))}
          {customPeriod && (
            <button type="button" class="chip" aria-pressed={true} onClick={clearPeriod}>
              指定した期間({shortDate(customPeriod.from)}〜{shortDate(customPeriod.to)})
            </button>
          )}
          <button
            type="button"
            class="chip"
            aria-pressed={picking !== null}
            onClick={() => setPicking(picking ? null : "start")}
          >
            {picking ? "期間の指定をやめる" : "期間を指定…"}
          </button>
        </div>
        {picking === "start" && <p class="hint">カレンダーで、始まりの日をタップしてください</p>}
        {picking && picking !== "start" && (
          <p class="hint">{dateLabel(picking)} から。終わりの日をタップしてください</p>
        )}
      </div>

      {state.period && (
        <div>
          <p class="step-title">
            1.1 曜日でしぼる({shortDate(state.period.from)}〜{shortDate(state.period.to)})
          </p>
          <div class="chips">
            {state.weekdays.map((on, i) => (
              <button
                type="button"
                key={i}
                class={`chip wd-chip ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}
                aria-pressed={on}
                onClick={() => toggleWeekday(i)}
              >
                {weekdayLabel(i)}
              </button>
            ))}
          </div>
          <div class="chips">
            <button type="button" class="chip" aria-pressed={sameDays(WEEKEND)} onClick={() => toggleShortcut(WEEKEND)}>
              土日だけ
            </button>
            <button
              type="button"
              class="chip"
              aria-pressed={sameDays(WEEKDAYS_ONLY)}
              onClick={() => toggleShortcut(WEEKDAYS_ONLY)}
            >
              平日だけ
            </button>
            <button type="button" class="chip" aria-pressed={sameDays(ALL_DAYS)} onClick={() => setWeekdays(ALL_DAYS)}>
              全部の曜日
            </button>
          </div>
        </div>
      )}

      <div>
        <p class="step-title">2. 1日ずつ足す・外す(日をタップ)</p>
        <p class="pick-count" role="status">
          候補日:<strong>{selected.length}日</strong>
          {selected.length > 0 && (
            <button
              type="button"
              class="btn-link"
              onClick={() => apply({ period: null, weekdays: ALL_DAYS, extras: [], removed: [] })}
            >
              全部外す
            </button>
          )}
        </p>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <PickerGrid
          selected={selected}
          range={props.range}
          today={props.today}
          availability={props.availability}
          pickingStart={picking && picking !== "start" ? picking : null}
          onTap={onDayTap}
        />
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function PickerGrid(props: {
  selected: string[];
  range: { from: string; to: string };
  today: string;
  availability?: Availability;
  pickingStart: string | null;
  onTap: (date: string) => void;
}) {
  const months = monthsBetween(props.today, props.range.to);
  const selected = new Set(props.selected);

  return (
    <div class="months">
      {months.map(({ year, month }) => {
        const first = `${year}-${pad(month)}-01`;
        const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
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
              {Array.from({ length: weekdayOf(first) }, (_, i) => (
                <div class="day empty" key={`b${i}`} aria-hidden="true" />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = addDays(first, i);
                const on = selected.has(date);
                const mine = props.availability?.[date];
                const wd = weekdayOf(date);
                const classes = [
                  "day",
                  "pick",
                  on ? "picked" : "",
                  props.pickingStart === date ? "pick-start" : "",
                  wd === 0 ? "sun" : wd === 6 ? "sat" : "",
                  date === props.today ? "today" : "",
                ].join(" ");
                return (
                  <button
                    type="button"
                    class={classes}
                    key={date}
                    disabled={date < props.range.from || date > props.range.to}
                    aria-pressed={on}
                    aria-label={`${dateLabel(date)}${mine ? ` 自分の予定:${STATUS_SYMBOL[mine.s]}` : ""}`}
                    onClick={() => props.onTap(date)}
                  >
                    <span class="num">{i + 1}</span>
                    {on && (
                      <span class="check-mark" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {mine && (
                      <span class={`mine s-${mine.s}`} aria-hidden="true">
                        {STATUS_SYMBOL[mine.s]}
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
