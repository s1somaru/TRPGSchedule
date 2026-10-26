// 卓への参加の流れ(spec.md 6.3 ⑥)
// - この端末にカレンダーがあれば、それで参加(1回押すだけ)
// - なければ「カレンダーを作って参加」か「ほかの端末のカレンダーを使う(編集URLを貼る)」
import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/limits";
import { api, ApiClientError } from "../api";
import { parseEditUrl } from "../logic";
import { graphemeLength } from "../format";
import { editUrl, storage, type StoredCalendar } from "../storage";
import { SaveUrl } from "./SaveUrl";
import { Sheet } from "./Sheet";

type Mode =
  | { kind: "choose" }
  | { kind: "create" }
  | { kind: "save"; cal: StoredCalendar }
  | { kind: "paste" };

export function JoinSheet(props: { sessionId: string; onClose: () => void; onJoined: () => void }) {
  const calendars = storage.calendars();
  const [mode, setMode] = useState<Mode>({ kind: calendars.length > 0 ? "choose" : "create" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async (cal: { id: string; secret: string }, displayName?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.join(props.sessionId, cal.secret, displayName || undefined);
      props.onJoined();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "ALREADY_JOINED") {
        // すでに参加していたなら、そのまま参加済みとして扱う
        props.onJoined();
        return;
      }
      if (err instanceof ApiClientError && err.status === 401) {
        setError("このカレンダーの編集URLは使えなくなっています。新しい編集URLを開いてから、もう一度お試しください");
      } else {
        setError(err instanceof Error ? err.message : "参加できませんでした");
      }
      setBusy(false);
    }
  };

  if (mode.kind === "save") {
    return (
      <Sheet title="カレンダーができました" onClose={props.onClose}>
        <p class="muted">参加する前に、あなたのカレンダーの編集URLを保存しましょう。</p>
        <SaveUrl
          url={editUrl(mode.cal.id, mode.cal.secret)}
          doneLabel={busy ? "参加しています…" : "この卓に参加する"}
          onDone={() => void join(mode.cal)}
        />
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  }

  if (mode.kind === "create") {
    return (
      <Sheet title="カレンダーを作って参加" onClose={props.onClose}>
        <CreateForm
          onCreated={(cal) => setMode({ kind: "save", cal })}
          onPaste={() => setMode({ kind: "paste" })}
          onBack={calendars.length > 0 ? () => setMode({ kind: "choose" }) : undefined}
        />
      </Sheet>
    );
  }

  if (mode.kind === "paste") {
    return (
      <Sheet title="ほかの端末のカレンダーを使う" onClose={props.onClose}>
        <PasteForm
          busy={busy}
          error={error}
          onSubmit={async (cal) => {
            setBusy(true);
            setError(null);
            try {
              const c = await api.getCalendar(cal.id, cal.secret);
              storage.rememberCalendar({ id: c.id, secret: cal.secret, displayName: c.displayName });
            } catch {
              setError("この編集URLは使えません。URLが途中で切れていないか確かめてください");
              setBusy(false);
              return;
            }
            await join(cal);
          }}
          onBack={() => setMode({ kind: calendars.length > 0 ? "choose" : "create" })}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title="この卓に参加する" onClose={props.onClose}>
      <ChooseForm
        calendars={calendars}
        busy={busy}
        error={error}
        onJoin={(cal, name) => void join(cal, name)}
        onCreate={() => setMode({ kind: "create" })}
        onPaste={() => setMode({ kind: "paste" })}
      />
    </Sheet>
  );
}

/**
 * 1人1つのカレンダーが前提なので、いつものカレンダー(この端末で一番最近開いたもの)で参加するのを主役にする。
 * 別のカレンダー・新しく作る・編集URLを貼る、は「ほかの方法」にまとめる
 */
function ChooseForm(props: {
  calendars: StoredCalendar[];
  busy: boolean;
  error: string | null;
  onJoin: (cal: StoredCalendar, displayName: string) => void;
  onCreate: () => void;
  onPaste: () => void;
}) {
  const [selected, setSelected] = useState(props.calendars[0]!.id);
  const [name, setName] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const cal = props.calendars.find((c) => c.id === selected)!;
  const nameLength = graphemeLength(name.trim());

  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        props.onJoin(cal, name.trim());
      }}
    >
      <p>
        「<strong>{cal.displayName}</strong>」のカレンダーで参加します。
      </p>
      <p class="muted">この卓の参加者には、候補日のあなたの予定(◯△×・時間・メモ)が見えます。</p>
      <label class="field">
        <span>この卓での名前(空なら「{cal.displayName}」)</span>
        <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="例:PC名" />
      </label>
      {nameLength > LIMITS.displayName && <p class="error-text">名前は{LIMITS.displayName}文字までです</p>}
      {props.error && (
        <p class="error-text" role="alert">
          {props.error}
        </p>
      )}
      <button type="submit" class="btn btn-primary btn-block btn-big" disabled={props.busy || nameLength > LIMITS.displayName}>
        {props.busy ? "参加しています…" : "参加する"}
      </button>

      {!showOthers ? (
        <button type="button" class="btn-link" onClick={() => setShowOthers(true)}>
          ほかの方法で参加する
        </button>
      ) : (
        <div class="card stack">
          {props.calendars.length > 1 && (
            <fieldset>
              <legend class="step-title">この端末にある別のカレンダー</legend>
              {props.calendars.map((c) => (
                <label class="check" key={c.id}>
                  <input type="radio" name="cal" checked={c.id === selected} onChange={() => setSelected(c.id)} />
                  {c.displayName}
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" class="btn btn-block" onClick={props.onPaste}>
            ほかの端末のカレンダーを使う(編集URLを貼る)
          </button>
          <button type="button" class="btn btn-block" onClick={props.onCreate}>
            新しくカレンダーを作って参加
          </button>
        </div>
      )}
    </form>
  );
}

function CreateForm(props: {
  onCreated: (cal: StoredCalendar) => void;
  onPaste: () => void;
  onBack?: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = graphemeLength(name.trim());

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cal = await api.createCalendar(name);
      storage.rememberCalendar({ id: cal.id, secret: cal.editSecret, displayName: cal.displayName });
      props.onCreated(storage.findCalendar(cal.id)!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作れませんでした");
      setBusy(false);
    }
  };

  return (
    <form class="stack" onSubmit={submit}>
      <p class="muted">
        予定を入れるカレンダーを作ります。ほかの卓でも、このカレンダーをそのまま使えます。
      </p>
      {props.onBack && (
        <p class="alert alert-notice">
          この端末には、すでにあなたのカレンダーがあります。カレンダーは1人1つあれば、どの卓にも使えます。新しく作ると、今のカレンダーの予定は引き継がれません。
        </p>
      )}
      <label class="field">
        <span>名前</span>
        <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="例:たろう" />
      </label>
      <div class={`counter ${length > LIMITS.displayName ? "over" : ""}`}>
        {length}/{LIMITS.displayName}
      </div>
      {error && (
        <p class="error-text" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        class="btn btn-primary btn-block btn-big"
        disabled={busy || length === 0 || length > LIMITS.displayName}
      >
        {busy ? "作っています…" : "カレンダーを作る"}
      </button>
      <div class="btn-row">
        <button type="button" class="btn-link" onClick={props.onPaste}>
          ほかの端末のカレンダーを使う
        </button>
        {props.onBack && (
          <button type="button" class="btn-link" onClick={props.onBack}>
            戻る
          </button>
        )}
      </div>
    </form>
  );
}

function PasteForm(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (cal: { id: string; secret: string }) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = parseEditUrl(text);

  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) props.onSubmit(parsed);
      }}
    >
      <p class="muted">
        ほかの端末で保存した、あなたのカレンダーの編集URLを貼り付けてください。この端末にも覚えさせます。
      </p>
      <input
        type="text"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder="https://…/c/…"
        aria-label="編集URL"
        autoComplete="off"
      />
      {text.trim() !== "" && !parsed && <p class="error-text">編集URLの形ではありません</p>}
      {props.error && (
        <p class="error-text" role="alert">
          {props.error}
        </p>
      )}
      <button type="submit" class="btn btn-primary btn-block btn-big" disabled={props.busy || !parsed}>
        {props.busy ? "参加しています…" : "このカレンダーで参加する"}
      </button>
      <button type="button" class="btn-link" onClick={props.onBack}>
        戻る
      </button>
    </form>
  );
}
