// 日付の計算のテスト
import { describe, expect, it } from "vitest";
import {
  acceptedRange,
  addDays,
  addMonths,
  inputRange,
  isValidDate,
  jstNow,
  pastCutoff,
} from "../src/shared/dates";

describe("日付の計算", () => {
  it("実在する日付だけを正しいとみなす", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-01")).toBe(false);
    expect(isValidDate("2026-01-01'; DROP TABLE calendars;--")).toBe(false);
  });

  it("日本時間で今日を決める(UTC 15時 = 日本の翌日0時)", () => {
    expect(jstNow(new Date("2026-10-25T14:59:00Z")).today).toBe("2026-10-25");
    expect(jstNow(new Date("2026-10-25T15:00:00Z")).today).toBe("2026-10-26");
  });

  it("月を足すと、ない日は月末にそろえる", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-10-25", 6)).toBe("2027-04-25");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("日を足し引きできる", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("入力できる期間は今日から6か月先まで", () => {
    expect(inputRange(new Date("2026-10-25T03:00:00Z"))).toEqual({
      from: "2026-10-25",
      to: "2027-04-25",
    });
  });

  it("日付が変わって10分間は前日も受け付ける", () => {
    // 日本時間 0:05
    expect(acceptedRange(new Date("2026-10-25T15:05:00Z")).from).toBe("2026-10-25");
    // 日本時間 0:10
    expect(acceptedRange(new Date("2026-10-25T15:10:00Z")).from).toBe("2026-10-26");
  });

  it("過去の予定は90日分残す", () => {
    expect(pastCutoff(new Date("2026-10-25T03:00:00Z"))).toBe("2026-07-27");
  });
});
