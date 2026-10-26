// スタンプの中身を決める画面(spec.md 3.19)
// 記号・時刻・メモのそれぞれを「変えない」「これにする」「消す」から選ぶ。
// 決めたスタンプは、記号のペンと同じようにタップや長押しなぞりで付けられる
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import { rangeLabel, type TimeRange } from "../../shared/time";
import type { Status } from "../../shared/types";
import { graphemeLength, STATUS_LABEL, STATUS_SYMBOL } from "../format";
import { isEmptyStamp, type Stamp } from "../logic";
import { Sheet } from "./Sheet";
import { TimeRangeInput } from "./TimeRangeInput";

type Mode = "keep" | "set" | "clear";

/** ペンの上に出す、スタンプの中身の短い説明。例:「◯・21:00〜・メモ:途中まで」 */
export function stampSummary(stamp: Stamp): string {
  const parts: string[] = [];
  if (stamp.s) parts.push(STATUS_SYMBOL[stamp.s]);
  if (stamp.time) parts.push(rangeLabel(stamp.time));
  else if (stamp.time === null) parts.push("時刻を消す");
  if (stamp.memo) parts.push(`メモ:${stamp.memo.replace(/\s+/g, " ")}`);
  else if (stamp.memo === null) parts.push("メモを消す");
  return parts.join("・");
}

const modeOf = (v: unknown): Mode => (v === undefined ? "keep" : v === null ? "clear" : "set");

function ModeChips(props: { value: Mode; onChange: (m: Mode) => void; allowClear?: boolean; setLabel: string }) {
  const items: { m: Mode; label: string }[] = [
    { m: "keep", label: "変えない" },
    { m: "set", label: props.setLabel },
    ...(props.allowClear === false ? [] : [{ m: "clear" as Mode, label: "消す" }]),
  ];
  return (
    <div class="chips">
      {items.map((it) => (
        <button type="button" key={it.m} class="chip" aria-pressed={props.value === it.m} onClick={() => props.onChange(it.m)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function StampEditor(props: {
  initial: Stamp;
  recentMemos: string[];
  onSave: (stamp: Stamp) => void;
  onClose: () => void;
}) {
  const [sMode, setSMode] = useState<Mode>(modeOf(props.initial.s));
  const [s, setS] = useState<Status>(props.initial.s ?? "o");
  const [timeMode, setTimeMode] = useState<Mode>(modeOf(props.initial.time));
  const [time, setTime] = useState<TimeRange | undefined>(props.initial.time ?? undefined);
  const [memoMode, setMemoMode] = useState<Mode>(modeOf(props.initial.memo));
  const [memo, setMemo] = useState(props.initial.memo ?? "");
  const memoLength = graphemeLength(memo.trim());

  const stamp: Stamp = {
    ...(sMode === "set" ? { s } : {}),
    ...(timeMode === "set" && time ? { time } : timeMode === "clear" ? { time: null } : {}),
    ...(memoMode === "set" && memo.trim() ? { memo: memo.trim() } : memoMode === "clear" ? { memo: null } : {}),
  };
  const empty = isEmptyStamp(stamp);
  const invalid = (timeMode === "set" && !time) || (memoMode === "set" && (!memo.trim() || memoLength > LIMITS.memo));

  return (
    <Sheet
      title="スタンプの中身"
      onClose={props.onClose}
      footer={
        <div class="btn-row">
          <button type="button" class="btn btn-primary" disabled={empty || invalid} onClick={() => props.onSave(stamp)}>
            このスタンプを使う
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      }
    >
      <div class="stack">
        <p class="muted">
          決めた中身を、タップや長押しなぞりでまとめて付けられます。「変えない」にした項目は、その日の今の内容が残ります。
        </p>

        <section class="stamp-part">
          <p class="step-title">記号</p>
          <ModeChips value={sMode} onChange={setSMode} allowClear={false} setLabel="これにする" />
          {sMode === "set" && (
            <div class="status-choice">
              {(["o", "t", "x"] as const).map((v) => (
                <button type="button" key={v} class={`p-${v}`} aria-pressed={s === v} aria-label={STATUS_LABEL[v]} onClick={() => setS(v)}>
                  {STATUS_SYMBOL[v]}
                </button>
              ))}
            </div>
          )}
          {sMode === "keep" && <p class="muted">記号のない日には付けません。</p>}
        </section>

        <section class="stamp-part">
          <p class="step-title">空いている時間</p>
          <ModeChips
            value={timeMode}
            onChange={(m) => {
              setTimeMode(m);
              // 時刻の欄が空のまま見えないように、よく使う夜の時刻を入れておく
              if (m === "set" && !time) setTime({ from: "20:00" });
            }}
            setLabel="これにする"
          />
          {timeMode === "set" && <TimeRangeInput value={time} onChange={setTime} allowEmpty={false} label="スタンプの時間" />}
          {timeMode === "set" && !time && <p class="error-text">始まりの時刻を選んでください</p>}
          {sMode === "set" && s === "x" && timeMode === "set" && <p class="muted">× の日には時刻は付きません。</p>}
        </section>

        <section class="stamp-part">
          <p class="step-title">メモ</p>
          <ModeChips value={memoMode} onChange={setMemoMode} setLabel="これにする" />
          {memoMode === "set" && (
            <>
              <textarea value={memo} onInput={(e) => setMemo(e.currentTarget.value)} aria-label="スタンプのメモ" />
              {props.recentMemos.length > 0 && (
                <div class="chips">
                  {props.recentMemos.map((m) => (
                    <button type="button" class="chip memo-chip" key={m} onClick={() => setMemo(m)} title={m}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div class={`counter ${memoLength > LIMITS.memo ? "over" : ""}`}>
                {memoLength}/{LIMITS.memo}
              </div>
            </>
          )}
        </section>
        {empty && <p class="muted">どれか1つは「これにする」か「消す」を選んでください。</p>}
      </div>
    </Sheet>
  );
}
