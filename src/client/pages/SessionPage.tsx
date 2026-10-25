// 卓ページ(spec.md 6.3 ⑤)。URL は /s/{卓ID}。URL を知っている人なら誰でも見られる
import { useEffect, useState } from "preact/hooks";
import { inputRange, jstNow } from "../../shared/dates";
import { hasActiveGm, judgeDate } from "../../shared/judge";
import { LIMITS } from "../../shared/limits";
import type { Role, SessionResponse } from "../../shared/types";
import { api, ApiClientError } from "../api";
import { DatePicker } from "../components/DatePicker";
import { JoinSheet } from "../components/JoinSheet";
import { SessionTable } from "../components/SessionTable";
import { Sheet } from "../components/Sheet";
import { dateLabel, graphemeLength, STATUS_SYMBOL } from "../format";
import { Link, navigate } from "../router";
import { storage, type StoredCalendar } from "../storage";
import { JUST_CREATED_KEY } from "./NewSession";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; session: SessionResponse; viewer: StoredCalendar | null }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

/**
 * 卓を読み、この卓でどのカレンダーとして振る舞うかを決める(spec.md 6.3「卓ページで、どのカレンダーとして振る舞うか」)。
 * 端末に覚えている各カレンダーの秘密を付けて卓を読み、参加者と分かった(me が入った)ものを使う。GM を優先する。
 * (参加中の卓の一覧には、記録になって開催日が決まらなかった卓が出ないので、一覧ではなく卓そのもので確かめる)
 */
async function loadSession(id: string): Promise<Load> {
  try {
    const tries = await Promise.all(
      storage.calendars().map(async (cal) => {
        try {
          const session = await api.getSession(id, cal.secret);
          return session.me ? { cal, session } : null;
        } catch (err) {
          // 卓がないときは、下の秘密なしの読み込みで 404 として扱う。秘密が使えないカレンダーは無視する
          if (err instanceof ApiClientError && err.status === 404) throw err;
          return null;
        }
      }),
    );
    const found = tries.filter((t): t is { cal: StoredCalendar; session: SessionResponse } => t !== null);
    const best = found.find((t) => t.session.me!.role === "GM") ?? found[0];
    if (best) return { kind: "ready", session: best.session, viewer: best.cal };
    return { kind: "ready", session: await api.getSession(id), viewer: null };
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return { kind: "notFound" };
    return { kind: "error", message: err instanceof Error ? err.message : "読み込めませんでした" };
  }
}

export function SessionPage(props: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const refresh = () =>
    loadSession(props.id).then((result) => {
      if (result.kind === "ready") storage.rememberSession({ id: props.id, title: result.session.title });
      setLoad(result);
    });

  useEffect(() => {
    void refresh();
    // ほかの画面から戻ってきたら、最新の予定を読み直す(ライブ参照)
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
  if (load.kind === "notFound") {
    return (
      <main class="page stack">
        <h1>卓が見つかりません</h1>
        <p>URLが途中で切れているか、卓が削除された可能性があります。</p>
        <Link href="/" class="btn btn-block">
          トップへ
        </Link>
      </main>
    );
  }
  if (load.kind === "error") {
    return (
      <main class="page stack">
        <p class="error-text" role="alert">
          {load.message}
        </p>
        <button type="button" class="btn" onClick={() => void refresh()}>
          もう一度読み込む
        </button>
      </main>
    );
  }
  if (load.session.archived) {
    return <ArchiveView session={load.session} viewer={load.viewer} />;
  }
  return <ActiveView session={load.session} viewer={load.viewer} onChanged={refresh} />;
}

function CopyLinkButton(props: { id: string; primary?: boolean }) {
  const [done, setDone] = useState<"ok" | "failed" | null>(null);
  const url = `${location.origin}/s/${props.id}`;
  return (
    <div>
      <button
        type="button"
        class={`btn btn-block ${props.primary ? "btn-primary btn-big" : ""}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setDone("ok");
          } catch {
            setDone("failed");
          }
        }}
      >
        卓URLをコピー
      </button>
      {done === "ok" && (
        <p class="muted center" role="status">
          コピーしました。参加してほしい人に送ってください。
        </p>
      )}
      {done === "failed" && (
        <input type="text" readOnly value={url} aria-label="卓URL" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}

type Panel =
  | { kind: "none" }
  | { kind: "day"; date: string }
  | { kind: "join" }
  | { kind: "edit" }
  | { kind: "rename" }
  | { kind: "leave" }
  | { kind: "delete" };

function ActiveView(props: { session: SessionResponse; viewer: StoredCalendar | null; onChanged: () => Promise<void> }) {
  const { session, viewer } = props;
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [justCreated, setJustCreated] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const today = jstNow().today;
  const me = session.me;
  const isGm = me?.role === "GM";
  const close = () => setPanel({ kind: "none" });

  useEffect(() => {
    try {
      if (sessionStorage.getItem(JUST_CREATED_KEY) === session.id) {
        setJustCreated(true);
        sessionStorage.removeItem(JUST_CREATED_KEY);
      }
    } catch {
      // 何もしない
    }
  }, [session.id]);

  /** 秘密を使う操作をして、終わったら読み直す */
  const act = async (fn: (secret: string) => Promise<unknown>) => {
    if (!viewer) return;
    setActionError(null);
    try {
      await fn(viewer.secret);
      await props.onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "うまくいきませんでした");
    }
  };

  return (
    <>
      <main class="page">
        <h1>{session.title}</h1>

        {session.confirmedDate && (
          <div class="confirmed-banner" role="status">
            <strong>{dateLabel(session.confirmedDate)}</strong>に開催
          </div>
        )}

        {justCreated ? (
          <div class="card stack">
            <p>
              <strong>卓ができました。</strong>参加してほしい人に、この卓のURLを送りましょう。
            </p>
            <CopyLinkButton id={session.id} primary />
          </div>
        ) : (
          <CopyLinkButton id={session.id} />
        )}
        <p class="muted">このページは、URLを知っている人なら誰でも見られます。</p>

        {!hasActiveGm(session.participants) && (
          <div class="alert alert-notice">管理するGMがいません。この卓の内容は変えられませんが、予定は見られます。</div>
        )}

        <SessionTable session={session} today={today} onDateTap={(date) => setPanel({ kind: "day", date })} />
        <p class="muted">日付を押すと、その日のメモが見られます。{isGm ? "開催日もそこで決められます。" : ""}</p>

        {actionError && (
          <p class="error-text" role="alert">
            {actionError}
          </p>
        )}

        <div class="stack actions">
          {!me && (
            <button type="button" class="btn btn-primary btn-block btn-big" onClick={() => setPanel({ kind: "join" })}>
              この卓に参加する
            </button>
          )}
          {me && viewer && (
            <>
              <Link href={`/c/${viewer.id}#${viewer.secret}`} class="btn btn-primary btn-block">
                自分の予定を変える
              </Link>
              <button type="button" class="btn btn-block" onClick={() => setPanel({ kind: "rename" })}>
                この卓での名前を変える
              </button>
            </>
          )}
        </div>

        {isGm && viewer && (
          <GmTools
            session={session}
            onEdit={() => setPanel({ kind: "edit" })}
            onDelete={() => setPanel({ kind: "delete" })}
            onRole={(pid, role) => act((s) => api.patchParticipant(session.id, pid, s, { role }))}
            onRemove={(pid) => act((s) => api.removeParticipant(session.id, pid, s))}
          />
        )}

        {me && !isGm && (
          <p>
            <button type="button" class="btn-link" onClick={() => setPanel({ kind: "leave" })}>
              この卓から抜ける
            </button>
          </p>
        )}
      </main>

      {panel.kind === "day" && (
        <DaySheet
          session={session}
          date={panel.date}
          isGm={isGm}
          onClose={close}
          onConfirm={(date) => {
            close();
            void act((s) => api.patchSession(session.id, s, { confirmedDate: date }));
          }}
        />
      )}
      {panel.kind === "join" && (
        <JoinSheet
          sessionId={session.id}
          onClose={close}
          onJoined={() => {
            close();
            void props.onChanged();
          }}
        />
      )}
      {panel.kind === "edit" && viewer && (
        <EditSheet
          session={session}
          onClose={close}
          onSave={async (body) => {
            await api.patchSession(session.id, viewer.secret, body);
            close();
            await props.onChanged();
          }}
        />
      )}
      {panel.kind === "rename" && viewer && me && (
        <SessionNameSheet
          current={session.participants.find((p) => p.id === me.participantId)?.displayName ?? ""}
          onClose={close}
          onSave={async (name) => {
            await api.patchParticipant(session.id, me.participantId, viewer.secret, { displayName: name });
            close();
            await props.onChanged();
          }}
        />
      )}
      {panel.kind === "leave" && me && (
        <ConfirmSheet
          title="この卓から抜ける"
          message="あなたの予定は、この卓に表示されなくなります。もう一度参加するには、卓URLから参加し直してください。"
          action="抜ける"
          onClose={close}
          onConfirm={() => {
            close();
            void act((s) => api.removeParticipant(session.id, me.participantId, s));
          }}
        />
      )}
      {panel.kind === "delete" && viewer && (
        <ConfirmSheet
          title="卓を削除"
          message="この卓のページが消え、参加者からも見られなくなります。元に戻せません。"
          action="削除する"
          onClose={close}
          onConfirm={async () => {
            try {
              await api.deleteSession(session.id, viewer.secret);
              storage.forgetSession(session.id);
              navigate(`/c/${viewer.id}#${viewer.secret}`);
            } catch (err) {
              close();
              setActionError(err instanceof Error ? err.message : "削除できませんでした");
            }
          }}
        />
      )}
    </>
  );
}

function GmTools(props: {
  session: SessionResponse;
  onEdit: () => void;
  onDelete: () => void;
  onRole: (pid: string, role: Role) => void;
  onRemove: (pid: string) => void;
}) {
  const me = props.session.me!;
  return (
    <section>
      <h2>GMの操作</h2>
      <button type="button" class="btn btn-block" onClick={props.onEdit}>
        タイトル・候補日を変える
      </button>

      <h3 class="sub-title">参加者</h3>
      <ul class="list">
        {props.session.participants.map((p) => (
          <li key={p.id}>
            <div class="row member-row">
              <span class={p.calendarDeleted ? "deleted" : ""}>
                {p.role === "GM" && <span class="tag tag-gm">GM</span>}
                {p.displayName}
                {p.id === me.participantId && <span class="muted">(あなた)</span>}
                {p.calendarDeleted && <span class="muted">(削除済み)</span>}
              </span>
              <span class="member-actions">
                {!p.calendarDeleted && (
                  <button
                    type="button"
                    class="btn btn-small"
                    onClick={() => props.onRole(p.id, p.role === "GM" ? "PL" : "GM")}
                  >
                    {p.role === "GM" ? "PLに戻す" : "GMにする"}
                  </button>
                )}
                {p.id !== me.participantId && (
                  <button type="button" class="btn btn-small btn-danger" onClick={() => props.onRemove(p.id)}>
                    外す
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p class="muted">共同GMを置くと、URLをなくしても卓を管理し続けられます。</p>

      <button type="button" class="btn btn-block btn-danger" onClick={props.onDelete}>
        卓を削除
      </button>
    </section>
  );
}

function DaySheet(props: {
  session: SessionResponse;
  date: string;
  isGm: boolean;
  onClose: () => void;
  onConfirm: (date: string | null) => void;
}) {
  const sum = judgeDate(props.session.participants, props.date);
  const confirmed = props.session.confirmedDate === props.date;
  const note = {
    ok: "GM全員が ◯ か △ の日です",
    ng: "GMの誰かが × の日です",
    unknown: hasActiveGm(props.session.participants) ? "まだ入力していないGMがいます" : "管理するGMがいません",
  }[sum.judgement];

  return (
    <Sheet title={dateLabel(props.date)} onClose={props.onClose}>
      <div class="stack">
        <p class="muted">
          {note}(◯{sum.o} △{sum.t} ×{sum.x})
        </p>
        <ul class="list">
          {props.session.participants.map((p) => {
            const e = p.availability[props.date];
            return (
              <li key={p.id}>
                <div class="row day-row">
                  <span class={p.calendarDeleted ? "deleted" : ""}>
                    {p.role === "GM" && <span class="tag tag-gm">GM</span>}
                    {p.displayName}
                    {e?.memo && <span class="memo-view muted day-memo">{e.memo}</span>}
                  </span>
                  <span class={`day-sym ${e ? `c-${e.s}` : ""}`}>{e ? STATUS_SYMBOL[e.s] : "−"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        {props.isGm &&
          (confirmed ? (
            <button type="button" class="btn btn-block" onClick={() => props.onConfirm(null)}>
              開催日の決定を取り消す
            </button>
          ) : (
            <button type="button" class="btn btn-primary btn-block btn-big" onClick={() => props.onConfirm(props.date)}>
              この日に決める
            </button>
          ))}
        <button type="button" class="btn btn-block" onClick={props.onClose}>
          閉じる
        </button>
      </div>
    </Sheet>
  );
}

function EditSheet(props: {
  session: SessionResponse;
  onClose: () => void;
  onSave: (body: { title: string; candidateDates: string[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.session.title);
  const [dates, setDates] = useState(props.session.candidateDates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleLength = graphemeLength(title.trim());
  const today = jstNow().today;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ title, candidateDates: dates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "変えられませんでした");
      setBusy(false);
    }
  };

  return (
    <Sheet title="タイトル・候補日を変える" onClose={props.onClose}>
      <div class="stack">
        <label class="field">
          <span>卓のタイトル</span>
          <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <div class={`counter ${titleLength > LIMITS.title ? "over" : ""}`}>
          {titleLength}/{LIMITS.title}
        </div>
        {props.session.confirmedDate && (
          <p class="muted">開催日({dateLabel(props.session.confirmedDate)})は候補日から外せません。外すときは、先に決定を取り消してください。</p>
        )}
        <DatePicker initial={props.session.candidateDates} range={inputRange()} today={today} onChange={setDates} />
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <div class="btn-row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || dates.length === 0 || titleLength === 0 || titleLength > LIMITS.title}
            onClick={save}
          >
            保存する
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function SessionNameSheet(props: { current: string; onClose: () => void; onSave: (name: string | null) => Promise<void> }) {
  const [name, setName] = useState(props.current);
  const [error, setError] = useState<string | null>(null);
  const length = graphemeLength(name.trim());

  const save = async (value: string | null) => {
    setError(null);
    try {
      await props.onSave(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "変えられませんでした");
    }
  };

  return (
    <Sheet title="この卓での名前" onClose={props.onClose}>
      <div class="stack">
        <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="この卓での名前" />
        <div class={`counter ${length > LIMITS.displayName ? "over" : ""}`}>
          {length}/{LIMITS.displayName}
        </div>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <div class="btn-row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={length === 0 || length > LIMITS.displayName}
            onClick={() => void save(name)}
          >
            変える
          </button>
          <button type="button" class="btn" onClick={() => void save(null)}>
            カレンダーの名前に戻す
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function ConfirmSheet(props: {
  title: string;
  message: string;
  action: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <div class="stack">
        <p>{props.message}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-danger" onClick={props.onConfirm}>
            {props.action}
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** 記録になった卓(spec.md 3.14)。予定は出さず、タイトル・開催日・参加者だけ */
function ArchiveView(props: { session: SessionResponse; viewer: StoredCalendar | null }) {
  const { session, viewer } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGm = session.me?.role === "GM";

  return (
    <main class="page stack">
      <h1>{session.title}</h1>
      <div class="confirmed-banner archived">
        {session.confirmedDate ? (
          <>
            <strong>{dateLabel(session.confirmedDate)}</strong>に開催
          </>
        ) : (
          "開催日は決まりませんでした"
        )}
      </div>
      <p class="muted">この卓は記録として保存されています。</p>
      <h2>参加者</h2>
      <ul class="list">
        {session.participants.map((p) => (
          <li key={p.id}>
            <div class="row">
              <span>
                <span class={`tag ${p.role === "GM" ? "tag-gm" : ""}`}>{p.role}</span>
                {p.displayName}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p class="error-text" role="alert">
          {error}
        </p>
      )}
      {isGm && viewer && (
        <button type="button" class="btn btn-block btn-danger" onClick={() => setConfirmDelete(true)}>
          記録を削除
        </button>
      )}
      {confirmDelete && viewer && (
        <ConfirmSheet
          title="記録を削除"
          message="この卓の記録が消えます。元に戻せません。"
          action="削除する"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await api.deleteSession(session.id, viewer.secret);
              storage.forgetSession(session.id);
              navigate(`/c/${viewer.id}#${viewer.secret}`);
            } catch (err) {
              setConfirmDelete(false);
              setError(err instanceof Error ? err.message : "削除できませんでした");
            }
          }}
        />
      )}
      <Link href="/" class="btn btn-block">
        トップへ
      </Link>
    </main>
  );
}
