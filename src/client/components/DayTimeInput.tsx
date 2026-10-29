// 本人の空いている時間を選ぶ部品(design/busy-and-multi-times.md 3.4)。1日に3つまで
// - 行は自分の state として持つ。親には「時刻なし」の行を除いた、まとめる前の値を渡す
// - まとめる(normalizeDayTime)のは、親が保存するときだけ
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import { normalizeDayTime, rangesOf, type DayTime, type TimeRange } from "../../shared/time";
import { TimeRangeInput } from "./TimeRangeInput";

type Row = TimeRange | undefined;

/** 空でない行を、親に渡す値にする(0個 → undefined、1個 → オブジェクト) */
function valueOf(rows: Row[]): DayTime | undefined {
  const filled = rows.filter((r): r is TimeRange => r !== undefined);
  if (filled.length === 0) return undefined;
  return filled.length === 1 ? filled[0] : filled;
}

/** 保存するとまとまる行があるか */
function willMerge(rows: Row[]): boolean {
  const filled = rows.filter((r): r is TimeRange => r !== undefined);
  return filled.length > 1 && rangesOf(normalizeDayTime(filled)).length < filled.length;
}

export function DayTimeInput(props: {
  value: DayTime | undefined;
  onChange: (value: DayTime | undefined) => void;
  label: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    const initial = rangesOf(props.value);
    return initial.length > 0 ? initial : [undefined];
  });
  const update = (next: Row[]) => {
    setRows(next);
    props.onChange(valueOf(next));
  };

  return (
    // 行ごとの欄に「空いている時間 1」のような名前が付くので、外側には付けない
    <div class="day-time">
      {rows.map((r, i) => (
        <div class="day-time-row" key={i}>
          <TimeRangeInput
            value={r}
            onChange={(next) => update(rows.map((x, j) => (j === i ? next : x)))}
            label={rows.length > 1 ? `${props.label} ${i + 1}` : props.label}
          />
          {rows.length > 1 && (
            <button
              type="button"
              class="btn-link day-time-remove"
              aria-label={`${props.label} ${i + 1} を消す`}
              onClick={() => update(rows.filter((_, j) => j !== i))}
            >
              消す
            </button>
          )}
        </div>
      ))}
      {/* 空の行があるうちは足せない(空の行を増やさない) */}
      {rows.length < LIMITS.dayTimeRanges && rows.every((r) => r !== undefined) && (
        <button type="button" class="btn-link day-time-add" onClick={() => update([...rows, undefined])}>
          ＋ 時間を足す
        </button>
      )}
      {willMerge(rows) && <p class="muted day-time-note">重なっている時間は、保存するときに1つにまとめます。</p>}
    </div>
  );
}
