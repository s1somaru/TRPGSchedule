// 入力された文字の掃除(spec.md 5.7 / 7.2)

// 文字の向きを変える特殊文字。表示を偽装するのに使われるので取り除く
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;
// 改行以外の制御文字
const CONTROLS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
// 目に見えない文字(幅ゼロの文字・ソフトハイフン・ハングルの埋め字など)。
// 空に見える名前や、ほかの人とそっくりな名前を作れないように取り除く
const INVISIBLES = /[­ᅟᅠ᠎​‌⁠-⁤ㅤ﻿ﾠ]/g;
// 幅ゼロの結合文字(ZWJ)は絵文字の組み合わせ(👨‍👩‍👧 など)に必要なので、絵文字のあいだにあるものだけ残す
const STRAY_ZWJ = /(?<!\p{Extended_Pictographic}️?)‍|‍(?!\p{Extended_Pictographic})/gu;
// 同じ文字に続く飾り記号(結合文字)は3個までにする。
// 見た目は1文字のまま、とても長い文字を作れないようにするため
const MARK_RUNS = /(\p{M}{3})\p{M}+/gu;
// 行を区切る特殊な文字
const LINE_SEPARATORS = /[\u2028\u2029]/g;

function common(value: string): string {
  return value
    .replace(BIDI_CONTROLS, "")
    .replace(INVISIBLES, "")
    .replace(STRAY_ZWJ, "")
    .replace(MARK_RUNS, "$1");
}

/** 1行の文字(名前・タイトル)。改行やタブは空白にして、前後の空白を除く */
export function cleanSingleLine(value: string): string {
  return common(value.replace(/[\r\n\t]+/g, " ").replace(LINE_SEPARATORS, " "))
    .replace(CONTROLS_EXCEPT_NEWLINE, "")
    .trim();
}

/** 複数行の文字(メモ)。改行は残し、前後の空白と空行を除く */
export function cleanMultiLine(value: string): string {
  return common(value.replace(/\r\n?/g, "\n").replace(LINE_SEPARATORS, "\n").replace(/\t/g, " "))
    .replace(CONTROLS_EXCEPT_NEWLINE, "")
    .trim();
}
