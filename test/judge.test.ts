// 「開催できる日」の判定のテスト(spec.md 3.4)
import { describe, expect, it } from "vitest";
import { hasActiveGm, judgeDate } from "../src/shared/judge";
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
