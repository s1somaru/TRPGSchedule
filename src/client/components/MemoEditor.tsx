// 1日分の詳しい予定を見る・書く(spec.md 3.8 / 3.18)
// - 記号(◯△×)。記号がない日は先に記号を選んでもらう
// - 空いている時間(◯ か △ のときだけ。任意)
// - メモ。「最近使ったメモ」を押すと、そのまま入る
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import type { TimeRange } from "../../shared/time";
import type { DayEntry, Status } from "../../shared/types";
import { dateLabel, graphemeLength, STATUS_LABEL, STATUS_SYMBOL } from "../format";
import { Sheet } from "./Sheet";
import { TimeRangeInput } from "./TimeRangeInput";

export function MemoEditor(props: {
  date: string;
  entry: DayEntry | undefined;
  /** その曜日の「いつもの時間」(時刻がまだない日に、最初から入れておく) */
  defaultTime?: TimeRange;
  /** 最近使ったメモ */
  recentMemos: string[];
  onSave: (entry: DayEntry) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(props.entry?.s ?? null);
  const [time, setTime] = useState<TimeRange | undefined>(props.entry?.time ?? (props.entry ? undefined : props.defaultTime));
  const [memo, setMemo] = useState(props.entry?.memo ?? "");
  const length = graphemeLength(memo.trim());
  const tooLong = length > LIMITS.memo;
  const canHaveTime = status === "o" || status === "t";

  const save = () => {
    if (!status || tooLong) return;
    const text = memo.trim();
    props.onSave({
      s: status,
      ...(text ? { memo: text } : {}),
      ...(time && canHaveTime ? { time } : {}),
    });
    props.onClose();
  };

  return (
    <Sheet
      title={dateLabel(props.date)}
      onClose={props.onClose}
      footer={
        <div class="btn-row">
          <button type="button" class="btn btn-primary" disabled={!status || tooLong} onClick={save}>
            保存する
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            閉じる
          </button>
        </div>
      }
    >
      <div class="stack">
        <div>
          <p class="muted">この日の予定</p>
          <div class="status-choice">
            {(["o", "t", "x"] as const).map((s) => (
              <button
                type="button"
                key={s}
                class={`p-${s}`}
                aria-pressed={status === s}
                aria-label={STATUS_LABEL[s]}
                onClick={() => {
                  setStatus(s);
                  // 初めて記号を選ぶときは、その曜日のいつもの時間を入れておく
                  if ((s === "o" || s === "t") && !time && !props.entry && props.defaultTime) setTime(props.defaultTime);
                }}
              >
                {STATUS_SYMBOL[s]}
              </button>
            ))}
          </div>
        </div>

        {canHaveTime && (
          <div>
            <p class="muted">空いている時間(任意。卓の時間帯と照らして、自動で判定します)</p>
            <TimeRangeInput value={time} onChange={setTime} label="空いている時間" />
          </div>
        )}

        <label class="field">
          <span>メモ</span>
          <textarea value={memo} onInput={(e) => setMemo(e.currentTarget.value)} placeholder="例:途中で抜けるかもしれません" />
        </label>
        {props.recentMemos.length > 0 && (
          <div>
            <p class="muted">最近使ったメモ(押すと入ります)</p>
            <div class="chips">
              {props.recentMemos.map((m) => (
                <button type="button" class="chip memo-chip" key={m} onClick={() => setMemo(m)} title={m}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        <div class={`counter ${tooLong ? "over" : ""}`}>
          {length}/{LIMITS.memo}
        </div>
        {!status && <p class="muted">先に ◯ △ × のどれかを選んでください。</p>}
      </div>
    </Sheet>
  );
}
