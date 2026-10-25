// 入力された文字の掃除のテスト(spec.md 5.7 / 7.2)
// 目に見えない文字は、テストのソースにも直接書かず \u の形で書く
import { describe, expect, it } from "vitest";
import { cleanMultiLine, cleanSingleLine } from "../src/shared/text";

describe("1行の文字(cleanSingleLine)", () => {
  it("文字の向きを変える特殊文字を取り除く", () => {
    for (const ch of ["⁦", "⁧", "⁨", "⁩", "‎", "‏", "؜", "‮"]) {
      expect(cleanSingleLine(`a${ch}b`)).toBe("ab");
    }
  });

  it("目に見えない文字を取り除く", () => {
    for (const ch of ["​", "ㅤ", "﻿", "­", "⁠"]) {
      expect(cleanSingleLine(`a${ch}b`)).toBe("ab");
    }
    // 目に見えない文字だけなら空になる
    expect(cleanSingleLine("ㅤ​﻿")).toBe("");
  });

  it("改行・タブ・行区切りの文字は空白になり、前後の空白は消える", () => {
    expect(cleanSingleLine("a\nb")).toBe("a b");
    expect(cleanSingleLine("a\r\nb")).toBe("a b");
    expect(cleanSingleLine("a\tb")).toBe("a b");
    expect(cleanSingleLine("a b")).toBe("a b");
    expect(cleanSingleLine("a b")).toBe("a b");
    expect(cleanSingleLine("  a  ")).toBe("a");
  });

  it("制御文字を取り除く", () => {
    expect(cleanSingleLine("a\u0000b\u0007c\u007F")).toBe("abc");
  });

  it("ZWJ は絵文字のあいだだけ残す", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    expect(cleanSingleLine(family)).toBe(family);
    // 異体字セレクタ(️)をはさんだ組み合わせも残す
    const rainbowFlag = "\u{1F3F3}️‍\u{1F308}";
    expect(cleanSingleLine(rainbowFlag)).toBe(rainbowFlag);
    // ふつうの文字のあいだ・端にあるものは消す
    expect(cleanSingleLine("a‍b")).toBe("ab");
    expect(cleanSingleLine("‍a")).toBe("a");
    expect(cleanSingleLine("\u{1F468}‍")).toBe("\u{1F468}");
  });

  it("飾り記号(結合文字)は3個までに縮める", () => {
    expect(cleanSingleLine("á́́́́")).toBe("á́́");
  });
});

describe("複数行の文字(cleanMultiLine)", () => {
  it("\\r\\n と \\r は \\n にそろえ、改行は残す", () => {
    expect(cleanMultiLine("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("行区切りの文字は改行にし、タブは空白にする", () => {
    expect(cleanMultiLine("a b")).toBe("a\nb");
    expect(cleanMultiLine("a\tb")).toBe("a b");
  });

  it("前後の空白・空行は除く", () => {
    expect(cleanMultiLine("\n\n  メモ  \n\n")).toBe("メモ");
  });

  it("向きを変える文字・目に見えない文字・制御文字は取り除く", () => {
    expect(cleanMultiLine("a⁦b​c\u0007d")).toBe("abcd");
  });
});
