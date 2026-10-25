// 画面の切り替え(URL のパスで決める)
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

const EVENT = "app:navigate";

/** 画面を移る(ページの読み込みはしない) */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

/** 今のパスを返し、移ったら画面を描き直す */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/** アプリの中だけで移るリンク */
export function Link(props: { href: string; class?: string; children: ComponentChildren }) {
  const onClick = (e: MouseEvent) => {
    // 新しいタブで開く操作などは、ブラウザに任せる
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(props.href);
  };
  return (
    <a href={props.href} class={props.class} onClick={onClick}>
      {props.children}
    </a>
  );
}
