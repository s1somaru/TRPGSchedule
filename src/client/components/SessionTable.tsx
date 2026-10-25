// 卓ページの表(spec.md 6.3 ⑤)。縦に候補日、横に参加者。
// ◯ と △ の人数は、横にスクロールしなくても見えるよう日付のすぐ右に置く
import { judgeDate } from "../../shared/judge";
import type { SessionResponse } from "../../shared/types";
import { dateLabel, shortDate, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";
import { MemoIcon } from "./Icons";

export function SessionTable(props: {
  session: SessionResponse;
  today: string;
  /** 表に出す日(並び順もこのとおり) */
  dates: string[];
  onDateTap: (date: string) => void;
}) {
  const { session, today } = props;
  const people = session.participants;

  return (
    <div class="table-wrap">
      <table class="sched">
        <thead>
          <tr>
            <th scope="col" class="col-date">
              日付
            </th>
            <th scope="col" class="col-sum">
              集計
            </th>
            {people.map((p) => (
              <th scope="col" key={p.id} class={p.calendarDeleted ? "deleted" : ""} title={p.displayName}>
                {p.role === "GM" && <span class="gm-mark">GM</span>}
                <span class="pname">{p.displayName}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.dates.map((date) => {
            const sum = judgeDate(people, date);
            const wd = weekdayOf(date);
            const classes = [
              sum.judgement === "ng" ? "row-ng" : "",
              date < today ? "row-past" : "",
              session.confirmedDates.includes(date) ? "row-confirmed" : "",
            ].join(" ");
            return (
              // 行のどこを押しても、その日の詳しい予定(メモ)を開く。キーボードでは日付のボタンを使う
              <tr key={date} class={`${classes} row-tap`} onClick={() => props.onDateTap(date)}>
                <th scope="row" class="col-date">
                  <button
                    type="button"
                    class="date-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDateTap(date);
                    }}
                    aria-label={`${dateLabel(date)}の詳しい予定`}
                  >
                    <span class={wd === 0 ? "sun" : wd === 6 ? "sat" : ""}>
                      {shortDate(date)}({weekdayLabel(wd)})
                    </span>
                    {session.confirmedDates.includes(date) && <span class="badge badge-confirmed">開催</span>}
                    {sum.allOk && !session.confirmedDates.includes(date) && <span class="badge badge-ok">全員OK</span>}
                  </button>
                </th>
                <td class="col-sum">
                  <span class="sum-o">◯{sum.o}</span> <span class="sum-t">△{sum.t}</span>
                </td>
                {people.map((p) => {
                  const e = p.availability[date];
                  return (
                    <td key={p.id} class={e ? `c-${e.s}` : ""}>
                      {e ? STATUS_SYMBOL[e.s] : ""}
                      {e?.memo && (
                        <span class="memo-mark" title="メモあり(押すと見られます)">
                          <MemoIcon size={15} title="メモあり" />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
