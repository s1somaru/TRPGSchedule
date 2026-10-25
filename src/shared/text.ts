// 入力された文字の掃除(spec.md 5.7 / 7.2)

// 文字の向きを変える特殊文字。表示を偽装するのに使われるので取り除く
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;
// 改行以外の制御文字
const CONTROLS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** 1行の文字(名前・タイトル)。改行やタブは空白にして、前後の空白を除く */
export function cleanSingleLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(BIDI_CONTROLS, "")
    .replace(CONTROLS_EXCEPT_NEWLINE, "")
    .trim();
}

/** 複数行の文字(メモ)。改行は残し、前後の空白と空行を除く */
export function cleanMultiLine(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(BIDI_CONTROLS, "")
    .replace(CONTROLS_EXCEPT_NEWLINE, "")
    .trim();
}
