// 全ページの上に出すヘッダ。左上のロゴを押すとトップへ戻る
import { Link } from "../router";
import { storage } from "../storage";
import { LogoMark } from "./Icons";

export const APP_NAME = "たくよせ";

export function Header(props: { path: string }) {
  // この端末で一番最近開いたカレンダー(1人1つの前提で、それを「自分のカレンダー」とする)
  const mine = storage.calendars()[0];
  const onCalendar = props.path.startsWith("/c/");

  return (
    <header class="site-header">
      <div class="site-header-inner">
        <Link href="/" class="brand">
          <LogoMark />
          <span class="brand-name">{APP_NAME}</span>
        </Link>
        <nav class="site-nav" aria-label="メニュー">
          {mine && !onCalendar && (
            <Link href={`/c/${mine.id}`} class="nav-link">
              自分のカレンダー
            </Link>
          )}
          {props.path !== "/new" && (
            <Link href="/new" class="nav-link nav-primary">
              卓を作る
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
