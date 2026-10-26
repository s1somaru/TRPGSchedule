// 時間帯を選ぶ部品(spec.md 3.18)。「始まり」と「終わり(任意)」の2つの選択欄
// 1日は朝6時〜翌朝6時。24時以降は「翌1:00」のように表示する
import { timeLabel, timeOptions, toMinutes, type TimeRange } from "../../shared/time";

const START_OPTIONS = timeOptions(false);
const END_OPTIONS = timeOptions(true);

export function TimeRangeInput(props: {
  value: TimeRange | undefined;
  onChange: (value: TimeRange | undefined) => void;
  /** 「指定しない」を選べるか */
  allowEmpty?: boolean;
  label?: string;
}) {
  const v = props.value;
  const setFrom = (from: string) => {
    if (!from) return props.onChange(undefined);
    // 終わりが始まりより前になったら、終わりを外す
    const to = v?.to && toMinutes(v.to) > toMinutes(from) ? v.to : undefined;
    props.onChange(to ? { from, to } : { from });
  };
  const setTo = (to: string) => {
    if (!v) return;
    props.onChange(to ? { from: v.from, to } : { from: v.from });
  };

  return (
    <div class="time-range" role="group" aria-label={props.label ?? "時間帯"}>
      <select value={v?.from ?? ""} onChange={(e) => setFrom(e.currentTarget.value)} aria-label="始まり">
        {props.allowEmpty !== false && <option value="">時刻なし</option>}
        {START_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {timeLabel(t)}
          </option>
        ))}
      </select>
      <span aria-hidden="true">〜</span>
      <select value={v?.to ?? ""} onChange={(e) => setTo(e.currentTarget.value)} disabled={!v} aria-label="終わり">
        <option value="">(終わりは決めない)</option>
        {END_OPTIONS.filter((t) => !v || toMinutes(t) > toMinutes(v.from)).map((t) => (
          <option key={t} value={t}>
            {timeLabel(t)}
          </option>
        ))}
      </select>
    </div>
  );
}
