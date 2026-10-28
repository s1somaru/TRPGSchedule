// 画面の計算部分のテスト(src/client/logic.ts・format.ts・undo.ts)。
// どちらも preact に頼らないので、Workers の環境でもそのまま読み込める
import { describe, expect, it } from "vitest";
import { confirmedSummary, relativeTime } from "../src/client/format";
import {
  ALL_DAYS,
  applyChanges,
  computePicked,
  daysBetween,
  monthsBetween,
  parseEditUrl,
  setDayPicked,
  toggleDay,
  type PickerState,
} from "../src/client/logic";
import { emptyHistory, recordChange, redo, undo, UNDO_LIMIT } from "../src/client/undo";
import type { DayEntry } from "../src/shared/types";

const ID = `cal_${"A".repeat(22)}`;
const SECRET = `sec_${"B".repeat(43)}`;

describe("編集URLの読み取り(parseEditUrl)", () => {
  it("正しい編集URLから ID と秘密を取り出す(前後の空白は無視)", () => {
    expect(parseEditUrl(`  https://example.com/c/${ID}#${SECRET}\n`)).toEqual({ id: ID, secret: SECRET });
  });

  it("パスが違うと null", () => {
    expect(parseEditUrl(`https://example.com/s/${ID}#${SECRET}`)).toBeNull();
    expect(parseEditUrl(`https://example.com/c/${ID}/x#${SECRET}`)).toBeNull();
    expect(parseEditUrl(`https://example.com/c/cal_short#${SECRET}`)).toBeNull();
  });

  it("秘密の形が違う・ないと null", () => {
    expect(parseEditUrl(`https://example.com/c/${ID}#sec_short`)).toBeNull();
    expect(parseEditUrl(`https://example.com/c/${ID}`)).toBeNull();
  });

  it("URL の形でなければ null", () => {
    expect(parseEditUrl("編集URLではない文字")).toBeNull();
    expect(parseEditUrl("")).toBeNull();
  });
});

describe("予定に変更を当てはめる(applyChanges)", () => {
  it("日を足し・置き換え・null で消す。元の予定は変えない", () => {
    const base = { "2026-11-01": { s: "o" as const }, "2026-11-02": { s: "x" as const } };
    const next = applyChanges(base, {
      "2026-11-01": null,
      "2026-11-02": { s: "t", memo: "夜" },
      "2026-11-03": { s: "o" },
    });
    expect(next).toEqual({ "2026-11-02": { s: "t", memo: "夜" }, "2026-11-03": { s: "o" } });
    expect(base).toEqual({ "2026-11-01": { s: "o" }, "2026-11-02": { s: "x" } });
  });
});

describe("月と日の一覧", () => {
  it("monthsBetween は年をまたいでも順に並べる", () => {
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
    expect(monthsBetween("2026-11-01", "2026-11-30")).toEqual([{ year: 2026, month: 11 }]);
  });

  it("daysBetween は両端を含み、月末・うるう年をまたげる", () => {
    expect(daysBetween("2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(daysBetween("2026-11-01", "2026-11-01")).toEqual(["2026-11-01"]);
    expect(daysBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("候補日の選び方(computePicked / toggleDay)", () => {
  // 2026-11-01 は日曜日
  const base: PickerState = {
    period: { from: "2026-11-01", to: "2026-11-07" },
    weekdays: [false, false, false, false, false, true, true], // 金・土だけ
    extras: [],
    removed: [],
  };

  it("期間・曜日・足した日・外した日をまとめ、日付順にする", () => {
    expect(computePicked(base)).toEqual(["2026-11-06", "2026-11-07"]);
    expect(computePicked({ ...base, extras: ["2026-11-20", "2026-11-02"], removed: ["2026-11-07"] })).toEqual([
      "2026-11-02",
      "2026-11-06",
      "2026-11-20",
    ]);
    expect(computePicked({ ...base, period: null, extras: ["2026-11-03"] })).toEqual(["2026-11-03"]);
    expect(computePicked({ ...base, weekdays: ALL_DAYS })).toHaveLength(7);
  });

  it("期間の中の日を外すと removed に入り、もう一度押すと戻る", () => {
    const off = toggleDay(base, "2026-11-06");
    expect(off.removed).toEqual(["2026-11-06"]);
    expect(off.extras).toEqual([]);
    expect(computePicked(off)).toEqual(["2026-11-07"]);
    const on = toggleDay(off, "2026-11-06");
    expect(on.removed).toEqual([]);
    expect(on.extras).toEqual([]);
    expect(computePicked(on)).toEqual(["2026-11-06", "2026-11-07"]);
  });

  it("期間の外の日(曜日が外れている日も含む)は extras に足し、もう一度押すと消える", () => {
    const outside = toggleDay(base, "2026-11-20");
    expect(outside.extras).toEqual(["2026-11-20"]);
    const offWeekday = toggleDay(outside, "2026-11-02"); // 期間の中だが月曜
    expect(offWeekday.extras).toEqual(["2026-11-20", "2026-11-02"]);
    expect(computePicked(offWeekday)).toEqual(["2026-11-02", "2026-11-06", "2026-11-07", "2026-11-20"]);
    const back = toggleDay(offWeekday, "2026-11-20");
    expect(back.extras).toEqual(["2026-11-02"]);
    expect(back.removed).toEqual([]);
  });
});

describe("長押しでなぞったときの候補日(setDayPicked)", () => {
  const base: PickerState = {
    period: { from: "2026-11-02", to: "2026-11-08" },
    weekdays: ALL_DAYS,
    extras: [],
    removed: [],
  };

  it("選んだ状態にする:期間外の日は足され、すでに選ばれている日は変わらない", () => {
    let s = setDayPicked(base, "2026-11-10", true);
    expect(computePicked(s)).toContain("2026-11-10");
    const same = setDayPicked(s, "2026-11-03", true);
    expect(same).toBe(s);
  });

  it("外した状態にする:期間内の日は外れ、選ばれていない日は変わらない", () => {
    const s = setDayPicked(base, "2026-11-03", false);
    expect(computePicked(s)).not.toContain("2026-11-03");
    expect(setDayPicked(s, "2026-11-20", false)).toBe(s);
  });

  it("なぞった日をまとめて足すと、全部選ばれる", () => {
    let s: PickerState = { period: null, weekdays: ALL_DAYS, extras: [], removed: [] };
    for (const d of ["2026-11-12", "2026-11-13", "2026-11-14"]) s = setDayPicked(s, d, true);
    expect(computePicked(s)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });
});

describe("表示の形(format.ts)", () => {
  it("confirmedSummary は次の開催日(なければ最後の開催日)と、ほかの日数を出す", () => {
    expect(confirmedSummary([], "2026-11-01")).toBe("");
    expect(confirmedSummary(["2026-11-14"], "2026-11-01")).toBe("11/14 開催");
    expect(confirmedSummary(["2026-10-01", "2026-11-14", "2026-12-05"], "2026-11-01")).toBe("11/14 開催(ほか2日)");
    expect(confirmedSummary(["2026-10-01", "2026-10-10"], "2026-11-01")).toBe("10/10 開催(ほか1日)");
    // 今日の開催日は「次」に数える
    expect(confirmedSummary(["2026-11-01", "2026-11-02"], "2026-11-01")).toBe("11/1 開催(ほか1日)");
  });

  it("relativeTime は分・時間・日で表し、未来の時刻は「たった今」", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(relativeTime(ago(30_000), now)).toBe("たった今");
    expect(relativeTime(ago(-60_000), now)).toBe("たった今");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5分前");
    expect(relativeTime(ago(59 * 60_000), now)).toBe("59分前");
    expect(relativeTime(ago(60 * 60_000), now)).toBe("1時間前");
    expect(relativeTime(ago(23 * 3600_000), now)).toBe("23時間前");
    expect(relativeTime(ago(3 * 86400_000), now)).toBe("3日前");
  });
});

describe("元に戻す・やり直す(undo.ts)", () => {
  const O: DayEntry = { s: "o" };
  const X: DayEntry = { s: "x" };
  const T: DayEntry = { s: "t", time: { from: "21:00" } };

  it("1日のタップを元に戻すと、変える前に戻る。やり直すと変えた後になる", () => {
    let h = recordChange(emptyHistory(), 1, "2026-11-01", null, O);
    h = recordChange(h, 2, "2026-11-01", O, X);
    const u = undo(h)!;
    expect(u.changes).toEqual({ "2026-11-01": O });
    const u2 = undo(u.history)!;
    expect(u2.changes).toEqual({ "2026-11-01": null });
    expect(undo(u2.history)).toBeNull();
    const r = redo(u2.history)!;
    expect(r.changes).toEqual({ "2026-11-01": O });
    expect(redo(r.history)!.changes).toEqual({ "2026-11-01": X });
  });

  it("同じ番号の変更(なぞった1回)は、1回でまとめて戻る", () => {
    let h = recordChange(emptyHistory(), 5, "2026-11-01", null, O);
    h = recordChange(h, 5, "2026-11-02", X, O);
    h = recordChange(h, 5, "2026-11-03", T, O);
    expect(h.done).toHaveLength(1);
    expect(undo(h)!.changes).toEqual({ "2026-11-01": null, "2026-11-02": X, "2026-11-03": T });
  });

  it("なぞり始めの日が変わらなくても、前の操作とは混ざらない", () => {
    let h = recordChange(emptyHistory(), 1, "2026-11-01", null, X);
    h = recordChange(h, 2, "2026-11-02", O, O); // なぞり始め:もう◯だった
    h = recordChange(h, 2, "2026-11-03", null, O);
    expect(h.done).toHaveLength(2);
    expect(undo(h)!.changes).toEqual({ "2026-11-03": null });
  });

  it("中身が変わらない変更は覚えない(時刻やメモも見比べる)", () => {
    let h = recordChange(emptyHistory(), 1, "2026-11-01", O, { s: "o" });
    expect(h.done).toHaveLength(0);
    h = recordChange(h, 2, "2026-11-01", T, { s: "t", time: { from: "21:00", to: "24:00" } });
    expect(h.done).toHaveLength(1);
    h = recordChange(h, 3, "2026-11-02", { s: "o", memo: "夜" }, { s: "o" });
    expect(h.done).toHaveLength(2);
  });

  it("新しく変えると、やり直せる手順は消える", () => {
    let h = recordChange(emptyHistory(), 1, "2026-11-01", null, O);
    h = undo(h)!.history;
    expect(h.undone).toHaveLength(1);
    h = recordChange(h, 2, "2026-11-02", null, X);
    expect(h.undone).toHaveLength(0);
    expect(redo(h)).toBeNull();
  });

  it("覚えておくのは新しい50回まで", () => {
    let h = emptyHistory();
    for (let i = 1; i <= UNDO_LIMIT + 5; i++) h = recordChange(h, i, "2026-11-01", i % 2 ? null : O, i % 2 ? O : null);
    expect(h.done).toHaveLength(UNDO_LIMIT);
    expect(h.done[0]!.op).toBe(6);
  });
});
