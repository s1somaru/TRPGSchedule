// 卓を作る(spec.md 6.3 ④)。この端末に覚えているカレンダーで作り、作った人が GM になる
import { useEffect, useState } from "preact/hooks";
import { inputRange, jstNow } from "../../shared/dates";
import { LIMITS } from "../../shared/limits";
import type { Availability } from "../../shared/types";
import { api, ApiClientError } from "../api";
import { DatePicker } from "../components/DatePicker";
import { TimeRangeInput } from "../components/TimeRangeInput";
import type { TimeRange } from "../../shared/time";
import { graphemeLength } from "../format";
import { Link, navigate } from "../router";
import { storage } from "../storage";

/** 作った直後の卓ページで「卓URLをコピー」を目立たせるための印 */
export const JUST_CREATED_KEY = "takuyose:just-created";

export function NewSession() {
  const calendars = storage.calendars();
  // いつものカレンダー(この端末で一番最近開いたもの)を使う
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? "");
  const [choosing, setChoosing] = useState(false);
  const [availability, setAvailability] = useState<Availability | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState<TimeRange | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = jstNow().today;
  const range = inputRange();
  const cal = calendars.find((c) => c.id === calendarId);
  const titleLength = graphemeLength(title.trim());

  // 選んだカレンダーの予定を読み、カレンダーに薄く重ねる
  useEffect(() => {
    if (!cal) return;
    setAvailability(undefined);
    api.getCalendar(cal.id, cal.secret).then(
      (c) => setAvailability(c.availability),
      () => setAvailability(undefined),
    );
  }, [calendarId]);

  if (!cal) {
    return (
      <main class="page stack">
        <h1>卓を作る</h1>
        <p>卓を作るには、先にあなたのカレンダーが必要です(作った人がGMとして参加します)。</p>
        <Link href="/" class="btn btn-primary btn-block btn-big">
          カレンダーを作る
        </Link>
        <p class="muted">ほかの端末でカレンダーを作った場合は、その編集URLをこの端末で一度開いてください。</p>
      </main>
    );
  }

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.createSession(cal.secret, { title, candidateDates: dates, ...(timeWindow ? { timeWindow } : {}) });
      try {
        sessionStorage.setItem(JUST_CREATED_KEY, s.id);
      } catch {
        // 覚えられなくても困らない
      }
      storage.rememberSession({ id: s.id, title: s.title });
      navigate(`/s/${s.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "作れませんでした");
      setBusy(false);
    }
  };

  const ready = titleLength > 0 && titleLength <= LIMITS.title && dates.length > 0;

  return (
    <main class="page page-wide">
      <h1>卓を作る</h1>
      <form class="stack" onSubmit={submit}>
        <p class="muted">
          「{cal.displayName}」のカレンダーで、GMとして参加します。
          {calendars.length > 1 && !choosing && (
            <>
              {" "}
              <button type="button" class="btn-link" onClick={() => setChoosing(true)}>
                別のカレンダーを使う
              </button>
            </>
          )}
        </p>
        {/* 1人1つのカレンダーが前提。この端末に複数あるときだけ選べるようにする */}
        {choosing && (
          <fieldset class="card">
            <legend class="step-title">GMとして参加するカレンダー</legend>
            {calendars.map((c) => (
              <label class="check" key={c.id}>
                <input
                  type="radio"
                  name="calendar"
                  checked={c.id === calendarId}
                  onChange={() => setCalendarId(c.id)}
                />
                {c.displayName}
              </label>
            ))}
          </fieldset>
        )}

        <label class="field">
          <span>卓のタイトル</span>
          <input
            type="text"
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="例:クトゥルフ神話TRPG 第3回"
            required
          />
        </label>
        <div class={`counter ${titleLength > LIMITS.title ? "over" : ""}`}>
          {titleLength}/{LIMITS.title}
        </div>

        <div>
          <p class="step-title">開催する時間帯(任意)</p>
          <p class="muted">決めておくと、参加者の空いている時間と照らして、時間が合うかを自動で判定します。</p>
          <TimeRangeInput value={timeWindow} onChange={setTimeWindow} label="開催する時間帯" />
        </div>

        <h2>候補日</h2>
        <p class="muted">カレンダーの右下の小さな記号は、あなたの予定です。</p>
        <DatePicker initial={[]} range={range} today={today} availability={availability} onChange={setDates} />

        <p class="alert alert-notice">共同GMを置くと、URLをなくしても卓を管理し続けられます(卓ができたあと、参加者をGMにできます)。</p>

        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <div class="submit-bar">
          <button type="submit" class="btn btn-primary btn-block btn-big" disabled={busy || !ready}>
            {busy ? "作っています…" : `卓を作る(候補日 ${dates.length}日)`}
          </button>
        </div>
      </form>
    </main>
  );
}
