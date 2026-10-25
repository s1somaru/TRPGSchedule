// 全ページの一番下に出すフッタ。評価の欄(そっと置く)と、問い合わせ・規約などへのリンク
import { useState } from "preact/hooks";
import { FEEDBACK_LIMITS } from "../../shared/limits";
import { api, ApiClientError, pageKind } from "../api";
import { graphemeLength } from "../format";
import { Link } from "../router";
import { APP_NAME } from "./Header";
import { LogoMark } from "./Icons";

export const REPO_URL = "https://github.com/s1somaru/takuyose";
const RATED_KEY = "takuyose:rated";

export function Footer(props: { path: string }) {
  // 自分のカレンダーでは、画面下の入力ペンに隠れないよう余白を足す
  const withPenBar = props.path.startsWith("/c/");
  return (
    <footer class={`site-footer ${withPenBar ? "with-pen-bar" : ""}`}>
      <RatingBox />
      <div class="footer-main">
        <div class="footer-brand">
          <Link href="/" class="brand footer-logo">
            <LogoMark />
            <span class="brand-name">{APP_NAME}</span>
          </Link>
          <p>予定は1回入れるだけ。参加している卓ぜんぶに反映されます。</p>
        </div>
        <nav class="footer-cols" aria-label="サイトの案内">
          <div>
            <h2>サポート</h2>
            <ul>
              <li>
                <Link href="/" state={{ scrollTo: "how" }}>
                  使い方
                </Link>
              </li>
              <li>
                <Link href="/contact">お問い合わせ</Link>
              </li>
              <li>
                <Link href="/contact" state={{ category: "bug" }}>
                  不具合の報告
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2>このサイトについて</h2>
            <ul>
              <li>
                <Link href="/terms">利用規約</Link>
              </li>
              <li>
                <Link href="/privacy">プライバシーポリシー</Link>
              </li>
              <li>
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                  ソースコード(GitHub)
                </a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <p class="footer-copy">© 2026 s1somaru</p>
    </footer>
  );
}

/** 「使い心地はいかがですか?」の欄。★を押したときだけ、ひとことの欄が開く */
function RatingBox() {
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [ratedBefore] = useState(() => {
    try {
      return Number(localStorage.getItem(RATED_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const length = graphemeLength(message.trim());

  const send = async () => {
    setState("sending");
    try {
      await api.sendFeedback({ kind: "rating", rating, message: message.trim() || undefined, page: pageKind() });
      try {
        localStorage.setItem(RATED_KEY, String(rating));
      } catch {
        // 覚えられなくても困らない
      }
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "送れませんでした");
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <div class="rating-box" role="status">
        <p class="rating-thanks">評価ありがとうございました!今後の改善に使わせていただきます。</p>
      </div>
    );
  }

  return (
    <div class="rating-box">
      <div class="rating-row">
        <span class="rating-q">
          {ratedBefore && rating === 0 ? `評価ありがとうございます(★${ratedBefore})。` : "使い心地はいかがですか?"}
        </span>
        <span class="stars" role="radiogroup" aria-label="5段階の評価">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              role="radio"
              aria-checked={rating === n}
              aria-label={`★${n}つ`}
              class={`star ${n <= rating ? "on" : ""}`}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </span>
      </div>
      {rating > 0 && (
        <div class="rating-more">
          <textarea
            value={message}
            onInput={(e) => setMessage(e.currentTarget.value)}
            placeholder="ひとこと(任意):よかったところ、使いにくかったところなど"
            aria-label="ひとこと"
          />
          <div class="rating-actions">
            <span class={`counter ${length > FEEDBACK_LIMITS.ratingMessage ? "over" : ""}`}>
              {length}/{FEEDBACK_LIMITS.ratingMessage}
            </span>
            <button type="button" class="btn" onClick={() => setRating(0)}>
              やめる
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={state === "sending" || length > FEEDBACK_LIMITS.ratingMessage}
              onClick={send}
            >
              {state === "sending" ? "送っています…" : "送る"}
            </button>
          </div>
          {state === "error" && (
            <p class="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
