// 画面の下から出るダイアログ。背景を押すか Esc で閉じる
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
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
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}
