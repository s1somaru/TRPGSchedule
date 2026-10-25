// 画面の下から出るダイアログ(PC では中央)。背景を押すか Esc で閉じる
// footer に渡したもの(保存・やめるボタンなど)は、中身が長くても常に下に見えるようにする
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Sheet(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      class="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class={`sheet ${props.wide ? "sheet-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        ref={ref}
      >
        <div class="sheet-body">
          <h2>{props.title}</h2>
          {props.children}
        </div>
        {props.footer && <div class="sheet-footer">{props.footer}</div>}
      </div>
    </div>
  );
}
