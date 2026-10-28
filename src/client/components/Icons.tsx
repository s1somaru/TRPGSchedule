// 画面で使うアイコン(SVG)。外部の画像やフォントは読み込まない
import type { JSX } from "preact";

type IconProps = { size?: number; class?: string; title?: string };

function Svg(props: IconProps & { children: JSX.Element | JSX.Element[] }) {
  const size = props.size ?? 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : "true"}
    >
      {props.children}
    </svg>
  );
}

/** 消しゴム */
export function EraserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 21h10" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L11 17H7l-3-3a2.1 2.1 0 0 1 0-3z" />
      <path d="M9.5 8.5l6 6" />
    </Svg>
  );
}

/** 元に戻す */
export function UndoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  );
}

/** やり直す */
export function RedoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  );
}

/** メモ(鉛筆) */
export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      <path d="M15 5l4 4" />
    </Svg>
  );
}

/** スタンプ(はんこ) */
export function StampIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3h6v4l-1 5h-4L9 7z" />
      <path d="M4 15h16v3H4z" />
      <path d="M6 21h12" />
    </Svg>
  );
}

/** メモ(吹き出し) */
export function MemoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </Svg>
  );
}

/** 時計(時間帯で判定したことを示す) */
export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

/** 斜線の入ったカレンダー(別の卓の予定が入っていることを示す) */
export function BusyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4M8 18l8-6" />
    </Svg>
  );
}

/** 戻る(左向きの矢印) */
export function BackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

/** 仮のロゴ(サイコロとカレンダーを合わせた形) */
export function LogoMark(props: IconProps) {
  const size = props.size ?? 28;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class={props.class}>
      <rect x="3" y="6" width="26" height="23" rx="6" fill="var(--accent)" />
      <rect x="3" y="6" width="26" height="7" rx="3" fill="var(--accent-strong)" />
      <rect x="9" y="3" width="3" height="6" rx="1.5" fill="var(--accent-strong)" />
      <rect x="20" y="3" width="3" height="6" rx="1.5" fill="var(--accent-strong)" />
      <circle cx="11" cy="19" r="2" fill="#fff" />
      <circle cx="21" cy="19" r="2" fill="#fff" />
      <circle cx="16" cy="24" r="2" fill="#fff" />
    </svg>
  );
}
