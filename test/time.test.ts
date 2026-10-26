// 時刻・時間帯の計算のテスト(spec.md 3.18)
import { describe, expect, it } from "vitest";
import {
  isValidRange,
  isValidTime,
  rangeLabel,
  shortRangeLabel,
  statusForWindow,
  timeLabel,
  timeOptions,
} from "../src/shared/time";

describe("時刻として使えるか", () => {
  it("06:00〜30:00 の30分刻みだけ使える", () => {
    expect(isValidTime("06:00")).toBe(true);
    expect(isValidTime("21:30")).toBe(true);
    expect(isValidTime("30:00")).toBe(true);
    expect(isValidTime("05:30")).toBe(false);
    expect(isValidTime("30:30")).toBe(false);
    expect(isValidTime("21:15")).toBe(false);
  });

  it("形が違うものは使えない", () => {
    expect(isValidTime("6:00")).toBe(false);
    expect(isValidTime("21時")).toBe(false);
    expect(isValidTime("")).toBe(false);
    expect(isValidTime("21:00:00")).toBe(false);
  });
});

describe("時間帯として正しいか", () => {
  it("終わりは省略できる", () => {
    expect(isValidRange({ from: "21:00" })).toBe(true);
  });

  it("始まり < 終わりのときだけ正しい", () => {
    expect(isValidRange({ from: "21:00", to: "24:00" })).toBe(true);
    expect(isValidRange({ from: "21:00", to: "21:00" })).toBe(false);
    expect(isValidRange({ from: "21:00", to: "20:00" })).toBe(false);
  });

  it("30:00 は終わりにだけ使える", () => {
    expect(isValidRange({ from: "22:00", to: "30:00" })).toBe(true);
    expect(isValidRange({ from: "30:00" })).toBe(false);
  });

  it("使えない時刻が混ざっていれば正しくない", () => {
    expect(isValidRange({ from: "05:30", to: "10:00" })).toBe(false);
    expect(isValidRange({ from: "21:00", to: "23:15" })).toBe(false);
  });
});

describe("選べる時刻の一覧", () => {
  it("始まり用は 06:00〜29:30", () => {
    const list = timeOptions();
    expect(list).toHaveLength(48);
    expect(list[0]).toBe("06:00");
    expect(list[list.length - 1]).toBe("29:30");
  });

  it("終わり用は 06:30〜30:00", () => {
    const list = timeOptions(true);
    expect(list).toHaveLength(48);
    expect(list[0]).toBe("06:30");
    expect(list[list.length - 1]).toBe("30:00");
  });

  it("どれも使える時刻になっている", () => {
    expect([...timeOptions(), ...timeOptions(true)].every(isValidTime)).toBe(true);
  });
});

describe("表示用の文字", () => {
  it("24時より前はそのまま、24時以降は「翌」を付ける", () => {
    expect(timeLabel("21:00")).toBe("21:00");
    expect(timeLabel("06:00")).toBe("6:00");
    expect(timeLabel("24:00")).toBe("24:00"); // ちょうど24時は「24:00」のまま
    expect(timeLabel("25:30")).toBe("翌1:30");
  });

  it("時間帯の表示", () => {
    expect(rangeLabel({ from: "21:00", to: "25:00" })).toBe("21:00〜翌1:00");
    expect(rangeLabel({ from: "21:00" })).toBe("21:00〜");
  });

  it("マス目に出す短い表示", () => {
    expect(shortRangeLabel({ from: "21:00" })).toBe("21〜");
    expect(shortRangeLabel({ from: "14:00", to: "18:00" })).toBe("14〜18");
    expect(shortRangeLabel({ from: "21:30" })).toBe("21:30〜");
  });
});

describe("卓の時間帯で記号を決める", () => {
  const W = { from: "21:00", to: "24:00" };

  it("本人の時間が卓の時間帯を全部含めば、記号のまま", () => {
    expect(statusForWindow("o", { from: "20:00", to: "25:00" }, W)).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("o", { from: "21:00", to: "24:00" }, W)).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("o", { from: "19:00" }, W)).toEqual({ s: "o", adjusted: false });
  });

  it("遅れて来るなら △", () => {
    expect(statusForWindow("o", { from: "22:00" }, W)).toEqual({ s: "t", adjusted: true });
  });

  it("途中で帰るなら △", () => {
    expect(statusForWindow("o", { from: "20:00", to: "23:00" }, W)).toEqual({ s: "t", adjusted: true });
  });

  it("卓の前に帰るなら ×(ちょうど始まりに帰る場合も)", () => {
    expect(statusForWindow("o", { from: "18:00", to: "20:00" }, W)).toEqual({ s: "x", adjusted: true });
    expect(statusForWindow("o", { from: "18:00", to: "21:00" }, W)).toEqual({ s: "x", adjusted: true });
  });

  it("卓が終わってから来るなら ×(ちょうど終わりに来る場合も)", () => {
    expect(statusForWindow("o", { from: "24:00" }, W)).toEqual({ s: "x", adjusted: true });
    expect(statusForWindow("t", { from: "25:00" }, W)).toEqual({ s: "x", adjusted: true });
  });

  it("卓の時間帯に終わりがなければ、その日の終わりまでとみなす", () => {
    const open = { from: "21:00" };
    expect(statusForWindow("o", { from: "20:00", to: "24:00" }, open)).toEqual({ s: "t", adjusted: true });
    expect(statusForWindow("o", { from: "20:00" }, open)).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("o", { from: "18:00", to: "21:00" }, open)).toEqual({ s: "x", adjusted: true });
  });

  it("× はそのまま ×", () => {
    expect(statusForWindow("x", { from: "20:00", to: "25:00" }, W)).toEqual({ s: "x", adjusted: false });
  });

  it("もともと △ の人が一部だけ重なっても、変わったことにはしない", () => {
    expect(statusForWindow("t", { from: "22:00" }, W)).toEqual({ s: "t", adjusted: false });
  });

  it("卓に時間帯がない、または本人が時刻を入れていなければ、記号のまま", () => {
    expect(statusForWindow("o", { from: "22:00" }, undefined)).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("t", undefined, W)).toEqual({ s: "t", adjusted: false });
  });
});
