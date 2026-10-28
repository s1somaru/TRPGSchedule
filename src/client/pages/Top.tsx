// トップ画面(spec.md 6.3 ①)と、カレンダーの作成 → URL保存(②)
import { useEffect, useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import { api, ApiClientError } from "../api";
import { BrandWordmark } from "../components/Brand";
import { Intro } from "../components/Intro";
import { SaveUrl } from "../components/SaveUrl";
import { graphemeLength } from "../format";
import { Link, navigate, navState } from "../router";
import { editUrl, storage } from "../storage";

type Step = { kind: "top" } | { kind: "create" } | { kind: "save"; id: string; secret: string };

export function Top() {
  const [step, setStep] = useState<Step>({ kind: "top" });

  if (step.kind === "create") {
    return (
      <CreateCalendar
        onCancel={() => setStep({ kind: "top" })}
        onCreated={(id, secret) => setStep({ kind: "save", id, secret })}
      />
    );
  }

  if (step.kind === "save") {
    return (
      <main class="page">
        <h1>カレンダーができました</h1>
        <p class="lead">最後に、編集URLを保存しましょう。</p>
        <SaveUrl
          url={editUrl(step.id, step.secret)}
          doneLabel="カレンダーへ進む"
          onDone={() => navigate(`/c/${step.id}`)}
        />
      </main>
    );
  }

  return <Home onCreate={() => setStep({ kind: "create" })} />;
}

function Home(props: { onCreate: () => void }) {
  const [calendars, setCalendars] = useState(storage.calendars());

  // フッタの「使い方」から来たら、使い方の見出しまでスクロールする(トップにいるときも)
  useEffect(() => {
    const scroll = () => {
      const target = navState().scrollTo;
      if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth" }), 0);
    };
    scroll();
    window.addEventListener("app:navigate", scroll);
    return () => window.removeEventListener("app:navigate", scroll);
  }, []);
  const [sessions, setSessions] = useState(storage.sessions());
  const mine = calendars[0];

  const clearHistory = () => {
    const message =
      "この端末に覚えている履歴を消しますか?" +
      "(カレンダーや卓そのものは消えません。編集URLを保存していないと、開けなくなります)";
    if (!confirm(message)) return;
    storage.clear();
    setCalendars([]);
    setSessions([]);
  };

  return (
    <main class="page page-wide">
      <section class="hero">
        <div class="hero-logo">
          <BrandWordmark />
        </div>
        <p class="hero-eyebrow">TRPGの日程調整</p>
        <h1>予定は1回入れるだけ。</h1>
        <p class="hero-lead">参加している卓ぜんぶに、あなたの予定が反映されます。</p>
        <ul class="hero-badges" aria-label="特徴">
          <li>登録・ログインなし</li>
          <li>無料</li>
          <li>スマホでもPCでも</li>
        </ul>
        <div class="hero-actions">
          {mine ? (
            <Link href={`/c/${mine.id}`} class="btn btn-primary btn-big">
              自分のカレンダーを開く
            </Link>
          ) : (
            <button type="button" class="btn btn-primary btn-big" onClick={props.onCreate}>
              カレンダーを作る
            </button>
          )}
          <Link href="/new" class="btn btn-big">
            卓を作る(GM)
          </Link>
        </div>
        {mine && (
          <p class="hero-sub">
            <button type="button" class="btn-link" onClick={props.onCreate}>
              別のカレンダーを作る
            </button>
          </p>
        )}
      </section>

      {(calendars.length > 0 || sessions.length > 0) && (
        <section class="recent">
          <h2>最近開いたもの</h2>
          <div class="recent-grid">
            {calendars.length > 0 && (
              <ul class="list" aria-label="カレンダー">
                {calendars.map((c) => (
                  <li key={c.id}>
                    <Link href={`/c/${c.id}`}>
                      <span>
                        <span class="tag">カレンダー</span>
                        {c.displayName}
                      </span>
                      <span class="sub">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {sessions.length > 0 && (
              <ul class="list" aria-label="卓">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/s/${s.id}`}>
                      <span>
                        <span class="tag">卓</span>
                        {s.title}
                      </span>
                      <span class="sub">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p>
            <button type="button" class="btn-link" onClick={clearHistory}>
              この端末の履歴を消す
            </button>
          </p>
        </section>
      )}

      <Intro onCreate={props.onCreate} hasCalendar={Boolean(mine)} />
    </main>
  );
}

function CreateCalendar(props: { onCancel: () => void; onCreated: (id: string, secret: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = graphemeLength(name.trim());

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cal = await api.createCalendar(name);
      storage.rememberCalendar({ id: cal.id, secret: cal.editSecret, displayName: cal.displayName });
      props.onCreated(cal.id, cal.editSecret);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "作成できませんでした");
      setBusy(false);
    }
  };

  return (
    <main class="page">
      <h1>カレンダーを作る</h1>
      <p class="lead">卓のページには、この名前で表示されます(あとで変えられます)。</p>
      {storage.calendars().length > 0 && (
        <p class="alert alert-notice">
          この端末には、すでにあなたのカレンダーがあります。カレンダーは1人1つあれば、どの卓にも使えます。新しく作ると、今のカレンダーの予定は引き継がれません。
        </p>
      )}
      <form class="stack" onSubmit={submit}>
        <label class="field">
          <span>名前</span>
          <input
            type="text"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="例:たろう"
            autoComplete="nickname"
            enterKeyHint="done"
            required
          />
        </label>
        <div class={`counter ${length > LIMITS.displayName ? "over" : ""}`}>
          {length}/{LIMITS.displayName}
        </div>
        {error && <p class="error-text" role="alert">{error}</p>}
        <button
          type="submit"
          class="btn btn-primary btn-block btn-big"
          disabled={busy || length === 0 || length > LIMITS.displayName}
        >
          {busy ? "作っています…" : "作る"}
        </button>
        <button type="button" class="btn btn-block" onClick={props.onCancel}>
          戻る
        </button>
      </form>
    </main>
  );
}
