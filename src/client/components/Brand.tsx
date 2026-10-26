// ロゴ(ヘッダー・フッター・トップの紹介で共通)
//
// 正式なロゴに差し替えるとき:
//   1. ロゴの画像を public/brand/ に置く(例:public/brand/logo.svg。正方形がおすすめ)
//   2. 下の LOGO_SRC に、そのパス(例:"/brand/logo.svg")を書く
//   3. ロゴの中に「たくよせ」の文字も入っているなら、LOGO_INCLUDES_NAME を true にする
//      (横長のロゴなら LOGO_WIDTH_RATIO に 横÷縦 を書く。例:横3・縦1 なら 3)
// タブのアイコン(public/favicon.svg)と、URLを貼ったときの画像(public/og-image.png)も、あわせて差し替える
/** サービスの名前 */
export const APP_NAME = "たくよせ";
import { LogoMark } from "./Icons";

const LOGO_SRC: string | null = null;
const LOGO_INCLUDES_NAME = false;
const LOGO_WIDTH_RATIO = 1;

/** ロゴの印だけ */
export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 28;
  if (LOGO_SRC) {
    return <img src={LOGO_SRC} width={Math.round(size * LOGO_WIDTH_RATIO)} height={size} alt="" class="brand-img" />;
  }
  return <LogoMark size={size} />;
}

/** ロゴの印と名前 */
export function Brand(props: { size?: number }) {
  if (LOGO_SRC && LOGO_INCLUDES_NAME) {
    return (
      <>
        <BrandMark size={props.size} />
        <span class="visually-hidden">{APP_NAME}</span>
      </>
    );
  }
  return (
    <>
      <BrandMark size={props.size} />
      <span class="brand-name">{APP_NAME}</span>
    </>
  );
}
