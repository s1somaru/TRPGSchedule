// 編集URLを保存してもらうパネル(spec.md 6.3 ②)。
// URL の文字列そのものは大きく出さず、コピー・QR・共有のボタンで渡す
import { useEffect, useState } from "preact/hooks";
import { Qr } from "./Qr";

export function SaveUrl(props: {
  url: string;
  /** 「保存した」にチェックを入れて進むとき */
  onDone: () => void;
  doneLabel: string;
}) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [saved, setSaved] = useState(false);
  const canShare = typeof navigator.share === "function";

  // 保存したと確かめる前に画面を離れようとしたら、確認を出す
  useEffect(() => {
    if (saved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saved]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.url);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "TRPGスケジュールの編集URL", url: props.url });
    } catch {
      // 共有をやめた場合など。何もしない
    }
  };

  return (
    <div class="stack">
      <div class="alert alert-danger" role="alert">
        <strong>このURLはパスワードと同じです。</strong>
        <br />
        なくすと二度と編集できません。他人に教えないでください。
      </div>

      <p>次のどれかで、このURLを自分だけが見られる場所に保存してください。</p>

      <div class="btn-row">
        <button type="button" class="btn btn-primary" onClick={copy}>
          URLをコピー
        </button>
        <button type="button" class="btn" onClick={() => setShowQr(!showQr)} aria-expanded={showQr}>
          {showQr ? "QRコードを閉じる" : "QRコードを表示"}
        </button>
        {canShare && (
          <button type="button" class="btn" onClick={share}>
            共有…
          </button>
        )}
      </div>

      {copied === "ok" && <p class="muted" role="status">コピーしました。メモアプリなどに貼り付けて保存してください。</p>}
      {copied === "failed" && (
        <div role="status">
          <p class="error-text">コピーできませんでした。下の欄を長押ししてコピーしてください。</p>
          <input type="text" readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} aria-label="編集URL" />
        </div>
      )}
      {showQr && <Qr value={props.url} label="編集URLのQRコード" />}

      <label class="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
        URLを保存した
      </label>

      <button type="button" class="btn btn-primary btn-block btn-big" disabled={!saved} onClick={props.onDone}>
        {props.doneLabel}
      </button>
    </div>
  );
}
