// 自分のカレンダー(spec.md 6.3 ③)。URL は /c/{カレンダーID}#{秘密}
import { useEffect, useRef, useState } from "preact/hooks";
import { jstNow } from "../../shared/dates";
import { ID_PATTERNS, newSecret } from "../../shared/ids";
import { LIMITS } from "../../shared/limits";
import type { JSX } from "preact";
import { rangeLabel, type TimeRange } from "../../shared/time";
import type { CalendarResponse, DayEntry, MySessionsResponse, Status, WeeklyTimes } from "../../shared/types";
import { TimeRangeInput } from "../components/TimeRangeInput";
import { api, ApiClientError } from "../api";
import { CalendarGrid } from "../components/CalendarGrid";
import { MemoEditor } from "../components/MemoEditor";
import { SaveUrl } from "../components/SaveUrl";
import { Sheet } from "../components/Sheet";
import { confirmedSummary, graphemeLength, relativeTime, shortDate, STATUS_SYMBOL, weekdayLabel, weekdayOf } from "../format";
import { BackIcon, ClockIcon, EraserIcon, PencilIcon, RedoIcon, StampIcon, UndoIcon } from "../components/Icons";
import { StampEditor, stampSummary } from "../components/StampEditor";
import { applyStamp, isEmptyStamp, sessionEventsByDate, stampFromEntry, type Stamp } from "../logic";
import { emptyHistory, recordChange, redo, undo, type UndoHistory } from "../undo";
import { Link, navigate, navState } from "../router";
import { editUrl, storage } from "../storage";
import { useAutosave } from "../useAutosave";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; cal: CalendarResponse; secret: string; openedFromOldUrl: boolean }
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
      // URL の秘密が使えず、この端末に覚えている新しい秘密で開けたとき(作り直す前の古いURLを開いた)
      const openedFromOldUrl = ID_PATTERNS.secret.test(fromUrl) && secret !== fromUrl;
      return { kind: "ready", cal, secret, openedFromOldUrl };
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
      openedFromOldUrl={load.openedFromOldUrl}
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

type Pen = Status | "erase" | "memo" | "stamp";

type Panel =
  | { kind: "none" }
  | { kind: "memo"; date: string }
  | { kind: "rename" }
  | { kind: "menu" }
  | { kind: "saveUrl" }
  | { kind: "reissue" }
  | { kind: "delete" }
  | { kind: "weekly" }
  | { kind: "stamp" };

function Editor(props: {
  initial: CalendarResponse;
  secret: string;
  openedFromOldUrl: boolean;
  onSecretChanged: (secret: string) => void;
  onUnauthorized: () => void;
}) {
  const id = props.initial.id;
  // 古いURLで開いたときの知らせ。少したったら自然に消す
  const [oldUrlNotice, setOldUrlNotice] = useState(props.openedFromOldUrl);
  useEffect(() => {
    if (!oldUrlNotice) return;
    const timer = setTimeout(() => setOldUrlNotice(false), 10_000);
    return () => clearTimeout(timer);
  }, [oldUrlNotice]);
  const [cal, setCal] = useState(props.initial);
  const [pen, setPen] = useState<Pen>("o");
  // スタンプペンの中身(spec.md 3.19)。この画面を開いている間だけ覚えておく
  const [stamp, setStamp] = useState<Stamp>({});
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [sessions, setSessions] = useState<MySessionsResponse | null>(null);
  // 参加中の卓の開催日(カレンダーのデータには入れず、印として出すだけ)
  const events = sessionEventsByDate(sessions);
  const today = jstNow().today;
  // 卓ページの「自分の予定を変える」から来たときの戻り先
  const returnTo = navState().returnTo;

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

  // 元に戻す・やり直す(src/client/undo.ts)。1回の操作(タップ・なぞった1回・メモの保存)ごとに番号を振る
  const [undoHistory, setUndoHistory] = useState<UndoHistory>(emptyHistory);
  const opCounter = useRef(0);
  const strokeOp = useRef(0);
  const nextOp = () => ++opCounter.current;

  /** 1日分を変えて、元に戻せるように覚えておく */
  const change = (op: number, date: string, entry: DayEntry | null) => {
    const before = save.entries[date] ?? null;
    setUndoHistory((h) => recordChange(h, op, date, before, entry));
    save.change(date, entry);
  };

  const replay = (result: ReturnType<typeof undo>) => {
    if (!result) return;
    setUndoHistory(result.history);
    for (const [date, entry] of Object.entries(result.changes)) save.change(date, entry);
  };
  const onUndo = () => replay(undo(undoHistory));
  const onRedo = () => replay(redo(undoHistory));

  /** その日の曜日の「いつもの時間」 */
  const weeklyFor = (date: string): TimeRange | undefined =>
    cal.weeklyTimes[String(weekdayOf(date)) as keyof WeeklyTimes];

  const applyPen = (date: string, op: number) => {
    const current = save.entries[date];
    if (pen === "erase") return change(op, date, null);
    if (pen === "memo") return setPanel({ kind: "memo", date });
    if (pen === "stamp") {
      // 「変えない」の項目は今の内容のまま。記号を変えないスタンプは、記号のない日には付けない
      const next = applyStamp(current, stamp);
      if (!next) return;
      // ◯ か △ にした日に時刻がなければ、ほかのペンと同じく曜日のいつもの時間を書き写す(3.18)
      const weekly = next.s !== "x" && !next.time && stamp.time === undefined ? weeklyFor(date) : undefined;
      change(op, date, weekly ? { ...next, time: weekly } : next);
      return;
    }
    // 記号を変えてもメモは残す(1日分はまとめて送る)。
    // ◯ か △ のとき:すでに時刻があればそのまま、なければ曜日の「いつもの時間」を書き写す。× のときは時刻を外す
    const time = pen === "x" ? undefined : (current?.time ?? weeklyFor(date));
    change(op, date, {
      s: pen,
      ...(current?.memo ? { memo: current.memo } : {}),
      ...(time ? { time } : {}),
    });
  };

  // 最近使ったメモ(日付の新しい順に、重ならないように最大6つ)
  const recentMemos = [
    ...new Set(
      Object.keys(save.entries)
        .sort()
        .reverse()
        .map((d) => save.entries[d]?.memo)
        .filter((m): m is string => Boolean(m)),
    ),
  ].slice(0, 6);

  const onTap = (date: string, memoDot: boolean) => {
    if (memoDot) setPanel({ kind: "memo", date });
    else applyPen(date, nextOp());
  };

  // 長押しでなぞった日は、なぞり始めから指を離すまでを1つの操作にする
  const onPaint = (date: string, first: boolean) => {
    if (first) strokeOp.current = nextOp();
    applyPen(date, strokeOp.current);
  };

  // PC のキーボード操作:1〜6 でペンを選ぶ、Ctrl+Z で元に戻す、Ctrl+Y(Ctrl+Shift+Z)でやり直す。
  // 文字を入力している間と、ダイアログを開いている間は反応しない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || panel.kind !== "none") return;
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key === "y") {
        e.preventDefault();
        onRedo();
        return;
      }
      if (mod || e.altKey || e.repeat) return;
      const index = Number(e.key) - 1;
      const choice = PENS[index];
      if (/^[1-6]$/.test(e.key) && choice) {
        e.preventDefault();
        choosePen(choice.pen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const choosePen = (next: Pen) => {
    setPen(next);
    // スタンプを選んだら、いつでも中身を決める画面を開く(今の中身が入った状態で)
    if (next === "stamp") setPanel({ kind: "stamp" });
  };

  const close = () => setPanel({ kind: "none" });

  return (
    <>
      <main class="page page-wide cal-page">
        {returnTo && (
          <Link href={`/s/${returnTo.sessionId}`} class="return-bar">
            <BackIcon />
            <span>
              「{returnTo.title}」の卓に戻る
            </span>
          </Link>
        )}
        {oldUrlNotice && (
          <div class="alert alert-notice old-url-notice" role="status">
            <p>
              開いたのは、作り直す前の古い編集URLでした。この端末に保存してある新しいURLで開いています。
              ブックマークやメモに古いURLを残している場合は、今のURLを保存し直してください。
            </p>
            <button type="button" class="old-url-close" aria-label="知らせを閉じる" onClick={() => setOldUrlNotice(false)}>
              ×
            </button>
          </div>
        )}
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

        <div class="cal-layout">
          <div class="cal-main">
            <SaveIndicator state={save.state} onRetry={save.retry} />
            {save.notice && <p class="muted">{save.notice}</p>}
            <button type="button" class="btn weekly-open" onClick={() => setPanel({ kind: "weekly" })}>
              <ClockIcon size={18} />
              {Object.keys(cal.weeklyTimes).length === 0 ? "曜日ごとのいつもの時間を決める" : "曜日ごとのいつもの時間を変える"}
            </button>

            <CalendarGrid
              availability={save.entries}
              events={events}
              range={cal.inputRange}
              today={today}
              canPaint={pen !== "memo"}
              onTap={onTap}
              onPaint={onPaint}
            />
          </div>

          <aside class="cal-side">
            <WeeklySummary weeklyTimes={cal.weeklyTimes} />
            <SessionsSection sessions={sessions} />

            <h2>卓を作る</h2>
            <Link href="/new" class="btn btn-block">
              この予定で卓を作る
            </Link>
          </aside>
        </div>
      </main>

      <PenBar
        pen={pen}
        stamp={stamp}
        onChange={choosePen}
        onEditStamp={() => setPanel({ kind: "stamp" })}
        canUndo={undoHistory.done.length > 0}
        canRedo={undoHistory.undone.length > 0}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      {panel.kind === "memo" && (
        <MemoEditor
          date={panel.date}
          entry={save.entries[panel.date]}
          defaultTime={weeklyFor(panel.date)}
          events={events[panel.date]}
          recentMemos={recentMemos}
          onSave={(entry: DayEntry) => change(nextOp(), panel.date, entry)}
          onMakeStamp={(entry: DayEntry) => {
            setStamp(stampFromEntry(entry));
            setPen("stamp");
          }}
          onClose={close}
        />
      )}
      {panel.kind === "stamp" && (
        <StampEditor
          initial={stamp}
          recentMemos={recentMemos}
          onSave={(next) => {
            setStamp(next);
            setPen("stamp");
            close();
          }}
          onClose={() => {
            // 中身を決めずに閉じたら、元の ◯ ペンに戻す
            if (isEmptyStamp(stamp)) setPen("o");
            close();
          }}
        />
      )}
      {panel.kind === "rename" && (
        <RenameSheet
          current={cal.displayName}
          onClose={close}
          onSave={async (name) => {
            const next = await api.patchCalendar(id, props.secret, { displayName: name });
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
            <Link href="/" class="btn btn-block">
              トップへ
            </Link>
            {/* 取り返しのつかない操作は一番下に */}
            <button type="button" class="btn btn-block btn-danger menu-danger" onClick={() => setPanel({ kind: "delete" })}>
              カレンダーを削除
            </button>
          </div>
        </Sheet>
      )}
      {panel.kind === "weekly" && (
        <WeeklySheet
          initial={cal.weeklyTimes}
          onClose={close}
          onSave={async (weeklyTimes) => {
            const next = await api.patchCalendar(id, props.secret, { weeklyTimes });
            setCal({ ...cal, weeklyTimes: next.weeklyTimes });
            close();
          }}
        />
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

const PENS: { pen: Pen; sym: string | JSX.Element; label: string }[] = [
  { pen: "o", sym: STATUS_SYMBOL.o, label: "参加できる" },
  { pen: "t", sym: STATUS_SYMBOL.t, label: "たぶん" },
  { pen: "x", sym: STATUS_SYMBOL.x, label: "できない" },
  { pen: "erase", sym: <EraserIcon size={24} />, label: "消す" },
  { pen: "memo", sym: <PencilIcon size={22} />, label: "メモ" },
  { pen: "stamp", sym: <StampIcon size={22} />, label: "スタンプ" },
];

function PenBar(props: {
  pen: Pen;
  stamp: Stamp;
  onChange: (pen: Pen) => void;
  onEditStamp: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div class="pen-bar">
      <div class="inner">
        <div class="pen-top">
          <button
            type="button"
            class="undo-btn"
            disabled={!props.canUndo}
            onClick={props.onUndo}
            title="元に戻す(Ctrl+Z)"
            aria-label="元に戻す"
          >
            <UndoIcon size={16} />
            <span>戻す</span>
          </button>
          {props.pen === "stamp" && !isEmptyStamp(props.stamp) ? (
            <div class="pen-hint stamp-hint">
              <span class="stamp-summary">スタンプ:{stampSummary(props.stamp)}</span>
              <button type="button" class="btn stamp-edit" onClick={props.onEditStamp}>
                中身を変える
              </button>
            </div>
          ) : (
            <div class="pen-hint">
              {props.pen === "memo" ? (
                "日をタップしてメモを書きます"
              ) : (
                <>
                  日をタップ。
                  <wbr />
                  長押ししてなぞると、
                  <wbr />
                  まとめて付きます
                </>
              )}
            </div>
          )}
          <button
            type="button"
            class="undo-btn"
            disabled={!props.canRedo}
            onClick={props.onRedo}
            title="やり直す(Ctrl+Y)"
          >
            <RedoIcon size={16} />
            <span>やり直す</span>
          </button>
        </div>
        <div class="pens" role="group" aria-label="入力ペン">
          {PENS.map((p, i) => (
            <button
              type="button"
              key={p.pen}
              class={`pen p-${p.pen}`}
              aria-pressed={props.pen === p.pen}
              aria-keyshortcuts={String(i + 1)}
              title={`${p.label}(${i + 1})`}
              onClick={() => props.onChange(p.pen)}
            >
              <span class="key" aria-hidden="true">
                {i + 1}
              </span>
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
  const today = jstNow().today;
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
                  {s.confirmedDates.length > 0
                    ? confirmedSummary(s.confirmedDates, today)
                    : `${shortDate(s.firstCandidateDate)}〜${shortDate(s.lastCandidateDate)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {active.some((s) => s.confirmedDates.length > 0) && (
        <p class="muted session-legend">
          開催日は、カレンダーの日付の数字に <span class="session-legend-num">色</span> が付きます。
        </p>
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
                  <span class="sub">
                    {s.confirmedDates.at(-1)!.replaceAll("-", "/")}
                    {s.confirmedDates.length > 1 ? `(全${s.confirmedDates.length}回)` : ""}
                  </span>
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

const WEEK_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

/** 曜日ごとの「いつもの時間」の一覧(右側・スマホでは下に出す) */
function WeeklySummary(props: { weeklyTimes: WeeklyTimes }) {
  const set = WEEK_KEYS.filter((k) => props.weeklyTimes[k]);
  if (set.length === 0) return null;
  return (
    <section>
      <h2>いつもの時間</h2>
      <ul class="list weekly-list">
        {set.map((k) => (
          <li key={k}>
            <div class="row">
              <span>{weekdayLabel(Number(k))}曜</span>
              <span class="sub">{rangeLabel(props.weeklyTimes[k]!)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 曜日ごとの「いつもの時間」を決める画面 */
function WeeklySheet(props: {
  initial: WeeklyTimes;
  onClose: () => void;
  onSave: (weeklyTimes: WeeklyTimes) => Promise<void>;
}) {
  const [value, setValue] = useState<WeeklyTimes>(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="曜日ごとのいつもの時間"
      onClose={props.onClose}
      footer={
        <div class="btn-row">
          <button type="button" class="btn btn-primary" disabled={busy} onClick={save}>
            保存する
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            やめる
          </button>
        </div>
      }
    >
      <div class="stack">
        <p class="muted">
          ◯や△を付けたとき、その日に時刻が入っていなければ、ここで決めた時刻が書き写されます。あとで変えても、すでに付けた日の時刻は変わりません。
        </p>
        {WEEK_KEYS.map((k) => (
          <div class="weekly-row" key={k}>
            <span class={`weekly-day ${k === "0" ? "sun" : k === "6" ? "sat" : ""}`}>{weekdayLabel(Number(k))}</span>
            <TimeRangeInput
              value={value[k]}
              label={`${weekdayLabel(Number(k))}曜のいつもの時間`}
              onChange={(r) => {
                const next = { ...value };
                if (r) next[k] = r;
                else delete next[k];
                setValue(next);
              }}
            />
          </div>
        ))}
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
