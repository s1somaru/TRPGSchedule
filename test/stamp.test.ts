// スタンプ(記号・時刻・メモをまとめて付けるペン)の計算のテスト(spec.md 3.19)
import { describe, expect, it } from "vitest";
import { applyStamp, isEmptyStamp, stampFromEntry, type Stamp } from "../src/client/logic";
import type { DayEntry } from "../src/shared/types";

const full: DayEntry = { s: "o", time: { from: "21:00" }, memo: "いつもの" };

describe("スタンプを当てはめる(applyStamp)", () => {
  it("時刻だけのスタンプは、記号とメモを変えずに時刻だけ付ける", () => {
    const stamp: Stamp = { time: { from: "20:00", to: "24:00" } };
    expect(applyStamp({ s: "t", memo: "メモ" }, stamp)).toEqual({ s: "t", memo: "メモ", time: { from: "20:00", to: "24:00" } });
  });

  it("メモだけのスタンプは、メモだけ付ける(時刻は残る)", () => {
    expect(applyStamp(full, { memo: "途中で抜けるかも" })).toEqual({ s: "o", time: { from: "21:00" }, memo: "途中で抜けるかも" });
  });

  it("「消す」を選んだ項目は消える", () => {
    expect(applyStamp(full, { time: null, memo: null })).toEqual({ s: "o" });
  });

  it("記号を変えないスタンプは、記号のない日には付けない", () => {
    expect(applyStamp(undefined, { time: { from: "21:00" } })).toBeUndefined();
  });

  it("記号つきのスタンプは、記号のない日にも付けられる", () => {
    expect(applyStamp(undefined, { s: "o", time: { from: "21:00" }, memo: "x" })).toEqual({ s: "o", time: { from: "21:00" }, memo: "x" });
  });

  it("× を付けるときは、時刻を付けない(メモは残る)", () => {
    expect(applyStamp(full, { s: "x" })).toEqual({ s: "x", memo: "いつもの" });
    expect(applyStamp(undefined, { s: "x", time: { from: "21:00" } })).toEqual({ s: "x" });
  });

  it("その日の内容をまるごと写すスタンプは、別の日を同じ内容にする", () => {
    const stamp = stampFromEntry(full);
    expect(applyStamp({ s: "x", memo: "前のメモ" }, stamp)).toEqual(full);
    // 時刻やメモのない日から作ったスタンプは、写した先の時刻・メモを消す
    expect(applyStamp(full, stampFromEntry({ s: "t" }))).toEqual({ s: "t" });
  });

  it("全部「変えない」のスタンプは空とみなす", () => {
    expect(isEmptyStamp({})).toBe(true);
    expect(isEmptyStamp({ memo: null })).toBe(false);
  });
});
