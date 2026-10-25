// 自分のカレンダー(spec.md 6.3 ③)。URL は /c/{カレンダーID}#{秘密}
import { useEffect, useState } from "preact/hooks";
import { jstNow } from "../../shared/dates";
import { ID_PATTERNS, newSecret } from "../../shared/ids";
import { LIMITS } from "../../shared/limits";
import type { CalendarResponse, DayEntry, MySessionsResponse, Status } from "../../shared/types";
import { api, ApiClientError } from "../api";
import { CalendarGrid } from "../components/CalendarGrid";
import { MemoEditor } from "../components/MemoEditor";
import { SaveUrl } from "../components/SaveUrl";
import { Sheet } from "../components/Sheet";
import { graphemeLength, relativeTime, shortDate, STATUS_SYMBOL } from "../format";
import { Link, navigate } from "../router";
import { editUrl, storage } from "../storage";
import { useAutosave } from "../useAutosave";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; cal: CalendarResponse; secret: string }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

/**
 * 使える秘密を探してカレンダーを読む。
 * - 作り直しの途中(pendingSecret)が残っていれば、先に送り直して終わらせる
 * - URL の秘密と、この端末に覚えている秘密を順に試す
 */
async function loadCalendar(id: string): Promise<Load> {
  const fromUrl = location.hash.slice(1);
  const stored = storage.findCalendar(id);

  if (stored?.pendingSecret) {
    try {
      await api.reissueSecret(id, stored.secret, stored.pendingSecret);
      storage.promotePendingSecret(id);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        // すでに置き換わっているか、別の端末で作り直された。新しいほうで読めるか確かめる
        try {
          await api.getCalendar(id, stored.pendingSecret);
          storage.promotePendingSecret(id);
        } catch {
          storage.setPendingSecret(id, null);
        }
      }
    }
  }

  const candidates = [
    ...new Set([fromUrl, storage.findCalendar(id)?.secret ?? ""].filter((s) => ID_PATTERNS.secret.test(s))),
  ];
  if (candidates.length === 0) return { kind: "invalid" };

  for (const secret of candidates) {
    try {
      const cal = await api.getCalendar(id, secret);
      return { kind: "ready", cal, secret };
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) continue;
      return { kind: "error", message: err instanceof Error ? err.message : "読み込めませんでした" };
    }
  }
  return { kind: "invalid" };
}

export function MyCalendar(props: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void loadCalendar(props.id).then((result) => {
      if (!alive) return;
      if (result.kind === "ready") {
        storage.rememberCalendar({ id: result.cal.id, secret: result.secret, displayName: result.cal.displayName });
        // アドレスバーには使える秘密を入れておく(ブックマークできるように)
        if (location.hash !== `#${result.secret}`) {
          history.replaceState(null, "", `/c/${result.cal.id}#${result.secret}`);
        }
      }
      setLoad(result);
    });
    return () => {
      alive = false;
    };
  }, [props.id]);

  if (load.kind === "loading") {
    return (
      <main class="page">
        <p class="muted" role="status">
          読み込んでいます…
        </p>
      </main>
    );
  }
  if (load.kind === "invalid") return <InvalidUrl id={props.id} />;
  if (load.kind === "error") {
    return (
      <main class="page stack">
        <p class="error-text" role="alert">
          {load.message}
        </p>
        <button type="button" class="btn" onClick={() => location.reload()}>
          もう一度読み込む
        </button>
      </main>
    );
  }
  return (
    <Editor
      key={load.secret}
      initial={load.cal}
      secret={load.secret}
      onSecretChanged={(secret) => setLoad({ ...load, secret })}
      onUnauthorized={() => setLoad({ kind: "invalid" })}
    />
  );
}

function InvalidUrl(props: { id: string }) {
  const remembered = storage.findCalendar(props.id) !== undefined;
  return (
    <main class="page stack">
      <h1>このURLは使えません</h1>
      <p>
        URLが途中で切れているか、ほかの端末で編集URLが作り直された可能性があります。新しい編集URLを保存している場合は、そちらを開いてください。
      </p>
      {remembered && (
        <button
          type="button"
          class="btn btn-block"
          onClick={() => {
            storage.forgetCalendar(props.id);
            navigate("/");
          }}
        >
          この端末の履歴から消す
        </button>
      )}
      <Link href="/" class="btn btn-block">
        トップへ
      </Link>
    </main>
  );
}

type Pen = Status | "erase" | "memo";

type Panel =
  | { kind: "none" }
  | { kind: "memo"; date: string }
  | { kind: "rename" }
  | { kind: "menu" }
  | { kind: "saveUrl" }
  | { kind: "reissue" }
  | { kind: "delete" };

function Editor(props: {
  initial: CalendarResponse;
  secret: string;
  onSecretChanged: (secret: string) => void;
  onUnauthorized: () => void;
}) {
  const id = props.initial.id;
  const [cal, setCal] = useState(props.initial);
  const [pen, setPen] = useState<Pen>("o");
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [sessions, setSessions] = useState<MySessionsResponse | null>(null);
  const today = jstNow().today;

  const save = useAutosave({
    calendarId: id,
    secret: props.secret,
    initial: props.initial.availability,
    onSaved: (next) => setCal(next),
    onUnauthorized: props.onUnauthorized,
  });

  useEffect(() => {
    api.mySessions(id, props.secret).then(setSessions, () => setSessions(null));
  }, [id, props.secret]);

  const applyPen = (date: string) => {
    const current = save.entries[date];
    if (pen === "erase") save.change(date, null);
    else if (pen === "memo") setPanel({ kind: "memo", date });
    // 記号を変えてもメモは残す(1日分はまとめて送る)
    else save.change(date, current?.memo ? { s: pen, memo: current.memo } : { s: pen });
  };

  const onTap = (date: string, memoDot: boolean) => {
    if (memoDot) setPanel({ kind: "memo", date });
    else applyPen(date);
  };

  const close = () => setPanel({ kind: "none" });

  return (
    <>
      <main class="page">
        <div class="alert alert-notice">
          このページのURLは人に送らないでください。卓に誘うときは、卓ページの「卓URLをコピー」を使います。
        </div>

        <div class="cal-header">
          <button type="button" class="name-btn" onClick={() => setPanel({ kind: "rename" })} aria-label="名前を変える">
            {cal.displayName}
          </button>
          <button type="button" class="menu-btn" aria-label="メニュー" onClick={() => setPanel({ kind: "menu" })}>
            ⋯
          </button>
        </div>
        <p class="muted">
          最終更新:{relativeTime(cal.lastUpdatedAt)}
          {" ・ "}
          <button type="button" class="btn-link" onClick={() => setPanel({ kind: "reissue" })}>
            覚えのない更新があったら
          </button>
        </p>

        <SaveIndicator state={save.state} onRetry={save.retry} />
        {save.notice && <p class="muted">{save.notice}</p>}

        <CalendarGrid
          availability={save.entries}
          range={cal.inputRange}
          today={today}
          canPaint={pen !== "memo"}
          onTap={onTap}
          onPaint={applyPen}
        />

        <SessionsSection sessions={sessions} />

        <h2>卓を作る</h2>
        <Link href="/new" class="btn btn-block">
          この予定で卓を作る
        </Link>
      </main>

      <PenBar pen={pen} onChange={setPen} />

      {panel.kind === "memo" && (
        <MemoEditor
          date={panel.date}
          entry={save.entries[panel.date]}
          onSave={(entry: DayEntry) => save.change(panel.date, entry)}
          onClose={close}
        />
      )}
      {panel.kind === "rename" && (
        <RenameSheet
          current={cal.displayName}
          onClose={close}
          onSave={async (name) => {
            const next = await api.renameCalendar(id, props.secret, name);
            setCal({ ...cal, displayName: next.displayName, lastUpdatedAt: next.lastUpdatedAt });
            storage.rememberCalendar({ id, secret: props.secret, displayName: next.displayName });
          }}
        />
      )}
      {panel.kind === "menu" && (
        <Sheet title="メニュー" onClose={close}>
          <div class="stack">
            <button type="button" class="btn btn-block" onClick={() => setPanel({ kind: "saveUrl" })}>
              このURLをもう一度保存する
            </button>
            <button type="button" class="btn btn-block" onClick={() => setPanel({ kind: "reissue" })}>
              URLを作り直す
            </button>
            <button type="button" class="btn btn-block btn-danger" onClick={() => setPanel({ kind: "delete" })}>
              カレンダーを削除
            </button>
            <Link href="/" class="btn btn-block">
              トップへ
            </Link>
          </div>
        </Sheet>
      )}
      {panel.kind === "saveUrl" && (
        <Sheet title="編集URLを保存" onClose={close}>
          <SaveUrl url={editUrl(id, props.secret)} doneLabel="閉じる" onDone={close} />
        </Sheet>
      )}
      {panel.kind === "reissue" && (
        <ReissueSheet
          id={id}
          secret={props.secret}
          onClose={close}
          onDone={(next) => {
            history.replaceState(null, "", `/c/${id}#${next}`);
            props.onSecretChanged(next);
          }}
        />
      )}
      {panel.kind === "delete" && <DeleteSheet id={id} secret={props.secret} onClose={close} />}
    </>
  );
}

function SaveIndicator(props: { state: string; onRetry: () => void }) {
  if (props.state === "error") {
    return (
      <div class="alert alert-danger" role="alert">
        保存できませんでした。{" "}
        <button type="button" class="btn-link" onClick={props.onRetry}>
          もう一度
        </button>
      </div>
    );
  }
  const text: Record<string, string> = {
    idle: "",
    pending: "保存の準備中…",
    saving: "保存しています…",
    saved: "保存しました",
  };
  return (
    <p class="save-state" role="status">
      {text[props.state]}
    </p>
  );
}

const PENS: { pen: Pen; sym: string; label: string }[] = [
  { pen: "o", sym: STATUS_SYMBOL.o, label: "参加できる" },
  { pen: "t", sym: STATUS_SYMBOL.t, label: "たぶん" },
  { pen: "x", sym: STATUS_SYMBOL.x, label: "できない" },
  { pen: "erase", sym: "消", label: "消す" },
  { pen: "memo", sym: "✎", label: "メモ" },
];

function PenBar(props: { pen: Pen; onChange: (pen: Pen) => void }) {
  return (
    <div class="pen-bar">
      <div class="inner">
        <div class="pen-hint">
          {props.pen === "memo" ? "日をタップしてメモを書きます" : "日をタップ。長押ししてなぞると、まとめて付きます"}
        </div>
        <div class="pens" role="group" aria-label="入力ペン">
          {PENS.map((p) => (
            <button
              type="button"
              key={p.pen}
              class={`pen p-${p.pen}`}
              aria-pressed={props.pen === p.pen}
              onClick={() => props.onChange(p.pen)}
            >
              <span class="sym" aria-hidden="true">
                {p.sym}
              </span>
              <span class="lbl">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionsSection(props: { sessions: MySessionsResponse | null }) {
  const [showAll, setShowAll] = useState(false);
  if (!props.sessions) return null;
  const { active, past } = props.sessions;
  const visiblePast = showAll ? past : past.slice(0, 5);

  return (
    <>
      <h2>参加中の卓</h2>
      {active.length === 0 ? (
        <p class="muted">まだありません。GMから届いた卓URLを開くと参加できます。</p>
      ) : (
        <ul class="list">
          {active.map((s) => (
            <li key={s.id}>
              <Link href={`/s/${s.id}`}>
                <span>
                  {s.role === "GM" && <span class="tag tag-gm">GM</span>}
                  {s.title}
                </span>
                <span class="sub">
                  {s.confirmedDate
                    ? `${shortDate(s.confirmedDate)} 開催`
                    : `${shortDate(s.firstCandidateDate)}〜${shortDate(s.lastCandidateDate)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <h2>これまでのセッション</h2>
          <ul class="list">
            {visiblePast.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`}>
                  <span>
                    <span class={`tag ${s.role === "GM" ? "tag-gm" : ""}`}>{s.role}</span>
                    {s.title}
                  </span>
                  <span class="sub">{s.confirmedDate.replaceAll("-", "/")}</span>
                </Link>
              </li>
            ))}
          </ul>
          {past.length > 5 && !showAll && (
            <button type="button" class="btn-link" onClick={() => setShowAll(true)}>
              もっと見る({past.length - 5}件)
            </button>
          )}
        </>
      )}
    </>
  );
}

function RenameSheet(props: { current: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(props.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = graphemeLength(name.trim());

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.onSave(name);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "変えられませんでした");
      setBusy(false);
    }
  };

  return (
    <Sheet title="名前を変える" onClose={props.onClose}>
      <form class="stack" onSubmit={submit}>
        <p class="muted">参加しているすべての卓で、この名前になります(卓ごとの名前を付けている卓は除く)。</p>
        <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="名前" />
        <div class={`counter ${length > LIMITS.displayName ? "over" : ""}`}>
          {length}/{LIMITS.displayName}
        </div>
        {error && <p class="error-text" role="alert">{error}</p>}
        <div class="btn-row">
          <button type="submit" class="btn btn-primary" disabled={busy || length === 0 || length > LIMITS.displayName}>
            変える
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** 編集URLを作り直す(spec.md 3.11)。新しい秘密は先に端末に保存してから送る */
function ReissueSheet(props: { id: string; secret: string; onClose: () => void; onDone: (secret: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reissue = async () => {
    setBusy(true);
    setError(null);
    // やり直しのときは、前に作った新しい秘密をそのまま使う(二重に作らない)
    const next = storage.findCalendar(props.id)?.pendingSecret ?? newSecret();
    storage.setPendingSecret(props.id, next);
    try {
      await api.reissueSecret(props.id, props.secret, next);
      storage.promotePendingSecret(props.id);
      setDone(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作り直せませんでした");
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet title="新しい編集URL" onClose={() => undefined}>
        <SaveUrl url={editUrl(props.id, done)} doneLabel="カレンダーへ戻る" onDone={() => props.onDone(done)} />
      </Sheet>
    );
  }

  return (
    <Sheet title="URLを作り直す" onClose={props.onClose}>
      <div class="stack">
        <p>
          覚えのない更新があったときや、URLを人に知られたかもしれないときに使います。
        </p>
        <ul>
          <li>今のURLは、すぐに使えなくなります</li>
          <li>ほかの端末では、新しいURLを開き直してください</li>
          <li>予定や参加中の卓は、そのまま残ります</li>
        </ul>
        {error && <p class="error-text" role="alert">{error}</p>}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" disabled={busy} onClick={reissue}>
            {busy ? "作り直しています…" : "作り直す"}
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function DeleteSheet(props: { id: string; secret: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ id: string; title: string }[]>([]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteCalendar(props.id, props.secret);
      storage.forgetCalendar(props.id);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "SOLE_GM_OF_SESSIONS") {
        setBlockers((err.details as { sessions: { id: string; title: string }[] }).sessions);
      }
      setError(err instanceof Error ? err.message : "削除できませんでした");
      setBusy(false);
    }
  };

  return (
    <Sheet title="カレンダーを削除" onClose={props.onClose}>
      <div class="stack">
        <p>
          予定がすべて消え、参加中の卓からも抜けます(卓には名前だけが残ります)。<strong>元に戻せません。</strong>
        </p>
        {error && <p class="error-text" role="alert">{error}</p>}
        {blockers.length > 0 && (
          <ul class="list">
            {blockers.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`}>
                  <span>{s.title}</span>
                  <span class="sub">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div class="btn-row">
          <button type="button" class="btn btn-danger" disabled={busy} onClick={remove}>
            削除する
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      </div>
    </Sheet>
  );
}
