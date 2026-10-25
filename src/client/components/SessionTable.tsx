// 卓ページの表(spec.md 6.3 ⑤)。縦に候補日、横に参加者。
// ◯ と △ の人数は、横にスクロールしなくても見えるよう日付のすぐ右に置く
import { judgeDate } from "../../shared/judge";
import type { SessionResponse } from "../../shared/types";
import { dateLabel, shortDate, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";

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
              session.confirmedDate === date ? "row-confirmed" : "",
            ].join(" ");
            return (
              <tr key={date} class={classes}>
                <th scope="row" class="col-date">
                  <button
                    type="button"
                    class="date-btn"
                    onClick={() => props.onDateTap(date)}
                    aria-label={`${dateLabel(date)}の詳しい予定`}
                  >
                    <span class={wd === 0 ? "sun" : wd === 6 ? "sat" : ""}>
                      {shortDate(date)}({weekdayLabel(wd)})
                    </span>
                    {session.confirmedDate === date && <span class="badge badge-confirmed">開催</span>}
                    {sum.allOk && session.confirmedDate !== date && <span class="badge badge-ok">全員OK</span>}
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
                        <span class="memo-mark" aria-label="メモあり">
                          *
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
