// ロゴ(ヘッダー・フッター・トップの紹介で共通)
//
// ロゴの画像は public/brand/ にある。暗い画面(ダークモード)では、暗い画面用の画像に自動で切り替える
//   header.png / header-dark.png     … ヘッダ用(時計と「たくよせ」の1行)
//   wordmark.png / wordmark-dark.png … 大きく出すとき用(英字の札つき)
// タブのアイコン(public/favicon.svg)と、URLを貼ったときの画像(public/og-image.png)は別のファイル
/** サービスの名前 */
export const APP_NAME = "たくよせ";
import { LogoMark } from "./Icons";

interface LogoImage {
  light: string;
  dark: string;
  /** 横÷縦 */
  ratio: number;
}

const HEADER_LOGO: LogoImage = { light: "/brand/header.png", dark: "/brand/header-dark.png", ratio: 1360 / 424 };
const WORDMARK: LogoImage = { light: "/brand/wordmark.png", dark: "/brand/wordmark-dark.png", ratio: 1360 / 460 };

/**
 * ロゴの画像。名前は画像の中にあるので、読み上げ用に名前を添える。
 * onDark: 背景がいつも暗い場所(フッタ)では、明るい画面でも暗い画面用を使う
 */
function LogoPicture(props: { logo: LogoImage; height: number; onDark?: boolean }) {
  const { logo, height } = props;
  const width = Math.round(height * logo.ratio);
  return (
    <>
      <picture>
        {!props.onDark && <source srcset={logo.dark} media="(prefers-color-scheme: dark)" />}
        <img src={props.onDark ? logo.dark : logo.light} width={width} height={height} alt="" class="brand-img" />
      </picture>
      <span class="visually-hidden">{APP_NAME}</span>
    </>
  );
}

/** ロゴの印だけ */
export function BrandMark(props: { size?: number }) {
  return <LogoMark size={props.size ?? 28} />;
}

/** ロゴの印と名前(ヘッダ・フッタ) */
export function Brand(props: { place?: "header" | "footer" }) {
  if (props.place === "footer") return <LogoPicture logo={WORDMARK} height={56} onDark />;
  return <LogoPicture logo={HEADER_LOGO} height={40} />;
}

/** 大きいロゴ(トップ) */
export function BrandWordmark(props: { height?: number }) {
  return <LogoPicture logo={WORDMARK} height={props.height ?? 96} />;
}
