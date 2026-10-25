// 1日分のメモを見る・書く(spec.md 3.8)。記号がない日は先に記号を選んでもらう
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import type { DayEntry, Status } from "../../shared/types";
import { dateLabel, graphemeLength, STATUS_LABEL, STATUS_SYMBOL } from "../format";
import { Sheet } from "./Sheet";

export function MemoEditor(props: {
  date: string;
  entry: DayEntry | undefined;
  onSave: (entry: DayEntry) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(props.entry?.s ?? null);
  const [memo, setMemo] = useState(props.entry?.memo ?? "");
  const length = graphemeLength(memo.trim());
  const tooLong = length > LIMITS.memo;

  const save = () => {
    if (!status || tooLong) return;
    const text = memo.trim();
    props.onSave(text ? { s: status, memo: text } : { s: status });
    props.onClose();
  };

  return (
    <Sheet title={dateLabel(props.date)} onClose={props.onClose}>
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
                onClick={() => setStatus(s)}
              >
                {STATUS_SYMBOL[s]}
              </button>
            ))}
          </div>
        </div>
        <label class="field">
          <span>メモ</span>
          <textarea
            value={memo}
            onInput={(e) => setMemo(e.currentTarget.value)}
            placeholder="例:21時からなら参加できます"
          />
        </label>
        <div class={`counter ${tooLong ? "over" : ""}`}>
          {length}/{LIMITS.memo}
        </div>
        {!status && <p class="muted">先に ◯ △ × のどれかを選んでください。</p>}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" disabled={!status || tooLong} onClick={save}>
            保存する
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Sheet>
  );
}
