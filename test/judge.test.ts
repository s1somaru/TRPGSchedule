// 「開催できる日」の判定のテスト(spec.md 3.4)
import { describe, expect, it } from "vitest";
import { hasActiveGm, judgeDate, windowFor } from "../src/shared/judge";
import type { TimeRange } from "../src/shared/time";
import type { ParticipantView, Status } from "../src/shared/types";

const D = "2026-11-03";
let n = 0;
function person(role: "GM" | "PL", s?: Status, deleted = false): ParticipantView {
  n += 1;
  return {
    id: `prt_${n}`,
    role,
    displayName: `${role}${n}`,
    calendarDeleted: deleted,
    availability: s && !deleted ? { [D]: { s } } : {},
  };
}

describe("開催できる日の判定", () => {
  it("GM全員が ◯ か △ なら開催できる", () => {
    const r = judgeDate([person("GM", "o"), person("GM", "t"), person("PL", "x")], D);
    expect(r.judgement).toBe("ok");
  });

  it("GMの誰かが × なら開催できない", () => {
    expect(judgeDate([person("GM", "o"), person("GM", "x"), person("PL", "o")], D).judgement).toBe("ng");
  });

  it("GMに未入力の人がいれば判定できない(× がいなければ)", () => {
    expect(judgeDate([person("GM", "o"), person("GM")], D).judgement).toBe("unknown");
  });

  it("未入力のGMがいても、別のGMが × なら開催できない", () => {
    expect(judgeDate([person("GM"), person("GM", "x")], D).judgement).toBe("ng");
  });

  it("カレンダーが残っているGMがいなければ判定できない", () => {
    const ps = [person("GM", undefined, true), person("PL", "o")];
    expect(hasActiveGm(ps)).toBe(false);
    expect(judgeDate(ps, D).judgement).toBe("unknown");
  });

  it("カレンダーが削除された人は集計に入れない", () => {
    const r = judgeDate([person("GM", "o"), person("PL", "o"), person("PL", undefined, true)], D);
    expect(r).toMatchObject({ o: 2, t: 0, x: 0, allOk: true });
  });

  it("◯△× の人数を数え、全員 ◯ のときだけ「全員OK」", () => {
    const r = judgeDate([person("GM", "o"), person("PL", "t"), person("PL", "x"), person("PL")], D);
    expect(r).toMatchObject({ o: 1, t: 1, x: 1, allOk: false });
  });
});

describe("卓の時間帯がある日の判定(spec.md 3.18)", () => {
  const W: TimeRange = { from: "21:00", to: "24:00" };
  function timed(role: "GM" | "PL", s: Status, time?: TimeRange): ParticipantView {
    const p = person(role, s);
    p.availability = { [D]: time ? { s, time } : { s } };
    return p;
  }

  it("GM が ◯ でも、時刻が卓の時間帯と重ならなければ開催できない", () => {
    const ps = [timed("GM", "o", { from: "18:00", to: "20:00" }), timed("PL", "o")];
    expect(judgeDate(ps, D).judgement).toBe("ok");
    expect(judgeDate(ps, D, W).judgement).toBe("ng");
  });

  it("人数は時刻で判定した記号で数える", () => {
    const ps = [
      timed("GM", "o", { from: "20:00" }),
      timed("PL", "o", { from: "22:00" }),
      timed("PL", "o", { from: "25:00" }),
      timed("PL", "t"),
    ];
    expect(judgeDate(ps, D, W)).toMatchObject({ judgement: "ok", o: 1, t: 2, x: 1, allOk: false });
  });

  it("時刻のせいで △ になった人がいれば「全員OK」にならない", () => {
    const ps = [timed("GM", "o"), timed("PL", "o", { from: "20:00", to: "23:00" })];
    expect(judgeDate(ps, D).allOk).toBe(true);
    expect(judgeDate(ps, D, W).allOk).toBe(false);
  });

  it("日ごとの時間帯があればそちらを使う", () => {
    const s = { timeWindow: W, dateTimes: { [D]: { from: "14:00" } } };
    expect(windowFor(s, D)).toEqual({ from: "14:00" });
    expect(windowFor(s, "2026-11-04")).toEqual(W);
    expect(windowFor({ timeWindow: null, dateTimes: {} }, D)).toBeUndefined();
  });
});
