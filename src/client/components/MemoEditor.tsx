// 1日分の詳しい予定を見る・書く(spec.md 3.8 / 3.18)
// - 記号(◯△×)。記号がない日は先に記号を選んでもらう
// - 空いている時間(◯ か △ のときだけ。任意)
// - メモ。「最近使ったメモ」を押すと、そのまま入る
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import { rangeLabel, rangesOf, type DayTime, type TimeRange } from "../../shared/time";
import type { DayEntry, Status } from "../../shared/types";
import { dateLabel, graphemeLength, holidayName, STATUS_LABEL, STATUS_SYMBOL } from "../format";
import type { SessionEvent } from "../logic";
import { Link } from "../router";
import { Sheet } from "./Sheet";
import { TimeRangeInput } from "./TimeRangeInput";

export function MemoEditor(props: {
  date: string;
  entry: DayEntry | undefined;
  /** その曜日の「いつもの時間」(時刻がまだない日に、最初から入れておく) */
  defaultTime?: TimeRange;
  /** この日が開催日になっている、参加中の卓 */
  events?: SessionEvent[];
  /** 最近使ったメモ */
  recentMemos: string[];
  onSave: (entry: DayEntry) => void;
  /** この日の内容をスタンプにする(保存してから、スタンプペンに切り替える) */
  onMakeStamp?: (entry: DayEntry) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(props.entry?.s ?? null);
  const [time, setTime] = useState<DayTime | undefined>(props.entry?.time ?? (props.entry ? undefined : props.defaultTime));
  const [memo, setMemo] = useState(props.entry?.memo ?? "");
  const length = graphemeLength(memo.trim());
  const tooLong = length > LIMITS.memo;
  const canHaveTime = status === "o" || status === "t";

  const current = (): DayEntry | null => {
    if (!status || tooLong) return null;
    const text = memo.trim();
    return { s: status, ...(text ? { memo: text } : {}), ...(time && canHaveTime ? { time } : {}) };
  };
  const save = () => {
    const entry = current();
    if (!entry) return;
    props.onSave(entry);
    props.onClose();
  };
  const makeStamp = () => {
    const entry = current();
    if (!entry) return;
    props.onSave(entry);
    props.onMakeStamp?.(entry);
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
        {holidayName(props.date) && <p class="holiday-name">{holidayName(props.date)}</p>}
        {props.events?.map((ev) => (
          <p class="session-event" key={ev.id}>
            この日は<Link href={`/s/${ev.id}`}>「{ev.title}」</Link>の開催日です
            {ev.time ? `(${rangeLabel(ev.time)})` : ""}
          </p>
        ))}
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
            {Array.isArray(time) ? (
              // 1日に複数の空いている時間がある日。行ごとに直せる(空にした行は消える)
              rangesOf(time).map((r, i, all) => (
                <TimeRangeInput
                  key={i}
                  value={r}
                  onChange={(next) => {
                    const rest = all.map((x, j) => (j === i ? next : x)).filter((x): x is TimeRange => x !== undefined);
                    setTime(rest.length > 1 ? rest : rest[0]);
                  }}
                  label={`空いている時間 ${i + 1}`}
                />
              ))
            ) : (
              <TimeRangeInput value={time} onChange={setTime} label="空いている時間" />
            )}
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
        {props.onMakeStamp && status && (
          <button type="button" class="btn-link stamp-make" disabled={tooLong} onClick={makeStamp}>
            この日の内容をスタンプにして、ほかの日にも付ける
          </button>
        )}
      </div>
    </Sheet>
  );
}
