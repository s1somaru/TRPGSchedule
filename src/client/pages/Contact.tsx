// お問い合わせ(spec.md 3.17)。内容はアプリの DB に保存し、運営者がコマンドで読む
import { useState } from "preact/hooks";
import { FEEDBACK_LIMITS } from "../../shared/limits";
import { api, ApiClientError, pageKind } from "../api";
import { graphemeLength } from "../format";
import { Link, navState } from "../router";

type Category = "bug" | "request" | "question" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "bug", label: "不具合の報告" },
  { value: "request", label: "要望・アイデア" },
  { value: "question", label: "使い方の質問" },
  { value: "other", label: "そのほか" },
];

export function Contact() {
  const [category, setCategory] = useState<Category | null>(navState().category ?? null);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = graphemeLength(message.trim());
  const contactLength = graphemeLength(contact.trim());

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedback({
        kind: "contact",
        category,
        message,
        contact: contact.trim() || undefined,
        page: pageKind(),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "送れませんでした");
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <main class="page stack">
        <h1>お問い合わせを受け付けました</h1>
        <p>ありがとうございます。いただいた内容は、運営者が確認します。</p>
        <p class="muted">返信先を書いていただいた場合も、すべてのお問い合わせに返信できるとは限りません。あらかじめご了承ください。</p>
        <Link href="/" class="btn btn-block">
          トップへ
        </Link>
      </main>
    );
  }

  return (
    <main class="page">
      <h1>お問い合わせ</h1>
      <p class="lead">不具合の報告や、要望・質問などをお送りください。</p>
      <form class="stack" onSubmit={submit}>
        <fieldset class="card">
          <legend class="step-title">種類</legend>
          <div class="chips">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.value}
                class="chip"
                aria-pressed={category === c.value}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label class="field">
          <span>内容</span>
          <textarea
            class="tall"
            value={message}
            onInput={(e) => setMessage(e.currentTarget.value)}
            placeholder={
              category === "bug"
                ? "どの画面で、何をしたら、どうなったか を書いていただけると助かります"
                : "自由にお書きください"
            }
          />
        </label>
        <div class={`counter ${length > FEEDBACK_LIMITS.contactMessage ? "over" : ""}`}>
          {length}/{FEEDBACK_LIMITS.contactMessage}
        </div>

        <label class="field">
          <span>返信先(任意)</span>
          <input
            type="text"
            value={contact}
            onInput={(e) => setContact(e.currentTarget.value)}
            placeholder="例:メールアドレス、Discord のユーザー名"
            autoComplete="off"
          />
        </label>
        <p class="muted">
          返信が必要な場合だけ書いてください。返信先は、お問い合わせへの対応のためだけに使い、1年で削除します(
          <Link href="/privacy">プライバシーポリシー</Link>)。
          <strong>編集URLは書かないでください</strong>(パスワードと同じです)。
        </p>
        {contactLength > FEEDBACK_LIMITS.replyTo && (
          <p class="error-text">返信先は{FEEDBACK_LIMITS.replyTo}文字までです</p>
        )}

        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          class="btn btn-primary btn-block btn-big"
          disabled={
            busy ||
            !category ||
            length === 0 ||
            length > FEEDBACK_LIMITS.contactMessage ||
            contactLength > FEEDBACK_LIMITS.replyTo
          }
        >
          {busy ? "送っています…" : "送る"}
        </button>
        {!category && <p class="muted center">種類を選ぶと送れます</p>}
      </form>
    </main>
  );
}
