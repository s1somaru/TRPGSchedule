// 卓ページ(spec.md 6.3 ⑤)。URL は /s/{卓ID}。URL を知っている人なら誰でも見られる
import { useEffect, useState } from "preact/hooks";
import { inputRange, jstNow } from "../../shared/dates";
import { cellStatus, hasActiveGm, judgeDate, windowFor } from "../../shared/judge";
import { rangeLabel, type TimeRange } from "../../shared/time";
import { TimeRangeInput } from "../components/TimeRangeInput";
import { LIMITS } from "../../shared/limits";
import type { Role, SessionResponse } from "../../shared/types";
import { api, ApiClientError } from "../api";
import { DatePicker } from "../components/DatePicker";
import { JoinSheet } from "../components/JoinSheet";
import { SessionTable } from "../components/SessionTable";
import { Sheet } from "../components/Sheet";
import { dateLabel, graphemeLength, holidayName, STATUS_SYMBOL } from "../format";
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
    // この卓で前に使ったカレンダーがあれば、まずそれだけで試す(通信を1回で済ませる)
    const lastId = storage.findSession(id)?.calendarId;
    const last = lastId ? storage.findCalendar(lastId) : undefined;
    if (last) {
      try {
        const session = await api.getSession(id, last.secret);
        if (session.me?.role === "GM" || (session.me && storage.calendars().length === 1)) {
          return { kind: "ready", session, viewer: last };
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) throw err;
      }
    }
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

/** タブの名前(index.html の title と同じ) */
const DEFAULT_TITLE = "たくよせ | TRPGの日程調整";

export function SessionPage(props: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const loadedTitle = load.kind === "ready" ? load.session.title : null;

  // タブの名前を「たくよせ(卓のタイトル)」にする(URLを貼ったときのカードと同じ)
  useEffect(() => {
    if (loadedTitle) document.title = `たくよせ（${loadedTitle}）`;
  }, [loadedTitle]);

  const refresh = () =>
    loadSession(props.id).then((result) => {
      if (result.kind === "ready") {
        storage.rememberSession({
          id: props.id,
          title: result.session.title,
          ...(result.viewer ? { calendarId: result.viewer.id } : {}),
        });
      }
      setLoad(result);
    });

  useEffect(() => {
    void refresh();
    // ほかの画面から戻ってきたら、最新の予定を読み直す(ライブ参照)
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      // ほかの画面へ移ったら、タブの名前を元に戻す
      document.title = DEFAULT_TITLE;
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

/**
 * 開催日の帯。次の開催日を一番大きく(時間帯つき)、ほかの開催日は下に小さく並べる。
 * 開催日が全部過ぎていたら、最後の開催日を「開催済み」として出す
 */
function ConfirmedBanner(props: {
  session: Pick<SessionResponse, "confirmedDates" | "timeWindow" | "dateTimes">;
  today: string;
  archived?: boolean;
}) {
  const dates = props.session.confirmedDates;
  if (dates.length === 0) return null;
  const next = dates.find((d) => d >= props.today);
  const main = next ?? dates[dates.length - 1]!;
  const done = next === undefined;
  const others = dates.filter((d) => d !== main);
  const timeOf = (d: string) => {
    const w = windowFor(props.session, d);
    return w ? ` ${rangeLabel(w)}` : "";
  };
  const cls = `confirmed-banner ${props.archived || done ? "archived" : ""}`;

  return (
    <div class={cls} role="status">
      <span class="banner-label">{done ? "開催済み" : next && others.length > 0 ? "次の開催日" : "開催日"}</span>
      <p class="banner-main">
        <strong>{dateLabel(main)}</strong>
        <span class="banner-time">{timeOf(main)}</span>
      </p>
      {others.length > 0 && (
        <div class="banner-others">
          <span class="banner-sub">ほかの開催日({others.length})</span>
          <ul class="confirmed-list">
            {others.map((d) => (
              <li key={d} class={d < props.today ? "done" : ""}>
                {dateLabel(d)}
                {timeOf(d)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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
      <main class="page page-wide">
        <h1>{session.title}</h1>

        <ConfirmedBanner session={session} today={today} />
        {session.timeWindow && <p class="time-window-note">開催する時間帯:{rangeLabel(session.timeWindow)}</p>}

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

        <ScheduleSection session={session} today={today} onDateTap={(date) => setPanel({ kind: "day", date })} />
        <p class="muted">日付や行を押すと、その日の全員の予定とメモが見られます。{isGm ? "開催日もそこで決められます。" : ""}</p>

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
              <Link
                href={`/c/${viewer.id}`}
                state={{ returnTo: { sessionId: session.id, title: session.title } }}
                class="btn btn-primary btn-block"
              >
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
          onConfirm={(date, confirm) => {
            close();
            // 開催日は複数あってよい。この日だけを足す・外す
            const next = confirm
              ? [...session.confirmedDates, date]
              : session.confirmedDates.filter((d) => d !== date);
            void act((s) => api.patchSession(session.id, s, { confirmedDates: next }));
          }}
          onDateTime={(date, range) => {
            close();
            // この日だけの時間帯。卓の時間帯と同じなら、日ごとの指定を外す
            const next = { ...session.dateTimes };
            const same =
              range && session.timeWindow && range.from === session.timeWindow.from && range.to === session.timeWindow.to;
            if (!range || same) delete next[date];
            else next[date] = range;
            void act((s) => api.patchSession(session.id, s, { dateTimes: next }));
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

/** 最初に出す候補日の数(これからの日) */
const FIRST_ROWS = 10;

/**
 * 候補日の表。候補日が多いと縦に長くなるので:
 * - これからの日は最初の10日だけ出し、残りは「残り○日を表示」で開く
 * - 過ぎた候補日は畳んでおく
 * - 「開催できる日だけ」に絞れる
 */
function ScheduleSection(props: { session: SessionResponse; today: string; onDateTap: (date: string) => void }) {
  const { session, today } = props;
  const [onlyOk, setOnlyOk] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const upcomingAll = session.candidateDates.filter((d) => d >= today);
  const upcoming = onlyOk
    ? upcomingAll.filter((d) => judgeDate(session.participants, d, windowFor(session, d)).judgement === "ok")
    : upcomingAll;
  const past = session.candidateDates.filter((d) => d < today);
  const visible = showAll ? upcoming : upcoming.slice(0, FIRST_ROWS);
  const hidden = upcoming.length - visible.length;
  const rows = showPast ? [...past, ...visible] : visible;

  return (
    <section>
      {/* 絞り込み・畳む操作は表の上にまとめる(長い表の一番下まで行かなくても戻せるように) */}
      <div class="chips table-tools">
        <button type="button" class="chip" aria-pressed={!onlyOk} onClick={() => setOnlyOk(false)}>
          これからの候補日({upcomingAll.length})
        </button>
        <button type="button" class="chip" aria-pressed={onlyOk} onClick={() => setOnlyOk(true)}>
          開催できる日だけ
        </button>
        {upcoming.length > FIRST_ROWS && (
          <button type="button" class="chip" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? `最初の${FIRST_ROWS}日だけにする` : `残り${hidden}日も表示`}
          </button>
        )}
        {past.length > 0 && (
          <button type="button" class="chip" aria-pressed={showPast} onClick={() => setShowPast(!showPast)}>
            {showPast ? "過ぎた候補日を隠す" : `過ぎた候補日(${past.length})も表示`}
          </button>
        )}
      </div>
      {rows.length > 0 ? (
        <SessionTable session={session} today={today} dates={rows} onDateTap={props.onDateTap} />
      ) : (
        <p class="muted empty-note">
          {onlyOk ? "GM全員が ◯ か △ の日は、まだありません。" : "これからの候補日はありません。"}
        </p>
      )}
      {hidden > 0 && (
        <div class="btn-row table-more">
          <button type="button" class="btn" onClick={() => setShowAll(true)}>
            残り{hidden}日を表示
          </button>
        </div>
      )}
    </section>
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
        タイトル・時間帯・候補日を変える
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
  onConfirm: (date: string, confirm: boolean) => void;
  /** この日だけの時間帯を変える(undefined で卓の時間帯に戻す) */
  onDateTime: (date: string, range: TimeRange | undefined) => void;
}) {
  const window = windowFor(props.session, props.date);
  const sum = judgeDate(props.session.participants, props.date, window);
  const confirmed = props.session.confirmedDates.includes(props.date);
  const hasOthers = props.session.confirmedDates.some((d) => d !== props.date);
  const [editingTime, setEditingTime] = useState(false);
  const [dayTime, setDayTime] = useState<TimeRange | undefined>(window);
  const note = {
    ok: "GM全員が ◯ か △ の日です",
    ng: "GMの誰かが × の日です",
    unknown: hasActiveGm(props.session.participants) ? "まだ入力していないGMがいます" : "管理するGMがいません",
  }[sum.judgement];

  return (
    <Sheet title={dateLabel(props.date)} onClose={props.onClose}>
      <div class="stack">
        {holidayName(props.date) && <p class="holiday-name">{holidayName(props.date)}</p>}
        {window && (
          <p class="time-window-note">
            この日の時間帯:{rangeLabel(window)}
            {props.session.dateTimes[props.date] && <span class="muted">(この日だけ)</span>}
          </p>
        )}
        <p class="muted">
          {note}(◯{sum.o} △{sum.t} ×{sum.x})
        </p>
        <ul class="list">
          {props.session.participants.map((p) => {
            const e = p.availability[props.date];
            const c = cellStatus(p, props.date, window);
            return (
              <li key={p.id}>
                <div class="row day-row">
                  <span class={p.calendarDeleted ? "deleted" : ""}>
                    {p.role === "GM" && <span class="tag tag-gm">GM</span>}
                    {p.displayName}
                    {e?.time && <span class="muted day-memo">空いている時間:{rangeLabel(e.time)}</span>}
                    {c?.adjusted && (
                      <span class="muted day-memo">
                        本人は {STATUS_SYMBOL[e!.s]}。時間帯が{c.s === "x" ? "合わない" : "一部だけ合う"}ため {STATUS_SYMBOL[c.s]} にしています
                      </span>
                    )}
                    {e?.memo && <span class="memo-view muted day-memo">{e.memo}</span>}
                  </span>
                  <span class={`day-sym ${c ? `c-${c.s}` : ""}`}>{c ? STATUS_SYMBOL[c.s] : "−"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        {props.isGm &&
          (confirmed ? (
            <button type="button" class="btn btn-block" onClick={() => props.onConfirm(props.date, false)}>
              この日の開催を取り消す
            </button>
          ) : (
            <button type="button" class="btn btn-primary btn-block btn-big" onClick={() => props.onConfirm(props.date, true)}>
              {hasOthers ? "この日も開催日にする" : "この日に決める"}
            </button>
          ))}
        {props.isGm &&
          (editingTime ? (
            <div class="card stack">
              <p class="step-title">この日だけの時間帯</p>
              <TimeRangeInput value={dayTime} onChange={setDayTime} label="この日だけの時間帯" />
              <div class="btn-row">
                <button type="button" class="btn btn-primary" onClick={() => props.onDateTime(props.date, dayTime)}>
                  この時間帯にする
                </button>
                {props.session.dateTimes[props.date] && (
                  <button type="button" class="btn" onClick={() => props.onDateTime(props.date, undefined)}>
                    卓の時間帯に戻す
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button type="button" class="btn-link" onClick={() => setEditingTime(true)}>
              この日だけ時間帯を変える
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
  onSave: (body: { title: string; candidateDates: string[]; timeWindow: TimeRange | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.session.title);
  const [dates, setDates] = useState(props.session.candidateDates);
  const [timeWindow, setTimeWindow] = useState<TimeRange | undefined>(props.session.timeWindow ?? undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleLength = graphemeLength(title.trim());
  const today = jstNow().today;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ title, candidateDates: dates, timeWindow: timeWindow ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "変えられませんでした");
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="タイトル・時間帯・候補日を変える"
      onClose={props.onClose}
      wide
      footer={
        <div class="btn-row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || dates.length === 0 || titleLength === 0 || titleLength > LIMITS.title}
            onClick={save}
          >
            保存する(候補日 {dates.length}日)
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      }
    >
      <div class="stack">
        <label class="field">
          <span>卓のタイトル</span>
          <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <div class={`counter ${titleLength > LIMITS.title ? "over" : ""}`}>
          {titleLength}/{LIMITS.title}
        </div>
        {props.session.confirmedDates.length > 0 && (
          <p class="muted">
            開催日({props.session.confirmedDates.map((d) => dateLabel(d)).join("、")})は候補日から外せません。外すときは、先にその日の開催を取り消してください。
          </p>
        )}
        <div>
          <p class="step-title">開催する時間帯(任意)</p>
          <TimeRangeInput value={timeWindow} onChange={setTimeWindow} label="開催する時間帯" />
        </div>
        <DatePicker initial={props.session.candidateDates} range={inputRange()} today={today} onChange={setDates} />
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
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
      {session.confirmedDates.length > 0 ? (
        <ConfirmedBanner session={session} today="0000-01-01" archived />
      ) : (
        <div class="confirmed-banner archived">開催日は決まりませんでした</div>
      )}
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
