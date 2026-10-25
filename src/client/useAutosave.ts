// 予定の自動保存(spec.md 6.3 ③)。
// 変更は1秒まとめて送る。画面を閉じる・隠れるときは、残りをすぐ送る
import { useEffect, useRef, useState } from "preact/hooks";
import type { Availability, CalendarResponse, DayEntry } from "../shared/types";
import { api, ApiClientError } from "./api";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

type Changes = Record<string, DayEntry | null>;

const DEBOUNCE_MS = 1000;

/** 予定に変更を当てはめる */
export function applyChanges(base: Availability, changes: Changes): Availability {
  const next = { ...base };
  for (const [date, entry] of Object.entries(changes)) {
    if (entry) next[date] = entry;
    else delete next[date];
  }
  return next;
}

export function useAutosave(opts: {
  calendarId: string;
  secret: string;
  initial: Availability;
  onSaved: (cal: CalendarResponse) => void;
  onUnauthorized: () => void;
}) {
  const [entries, setEntries] = useState<Availability>(opts.initial);
  const [state, setState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<Changes>({});
  const inflight = useRef(false);
  const timer = useRef<number | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const hasPending = () => Object.keys(pending.current).length > 0;

  const flush = async (keepalive = false): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current || !hasPending()) return;
    let batch = pending.current;
    pending.current = {};
    inflight.current = true;
    setState("saving");
    const { calendarId, secret } = optsRef.current;
    try {
      let res: CalendarResponse;
      try {
        res = await api.putAvailability(calendarId, secret, batch, keepalive);
      } catch (err) {
        // 日付が変わって入力できなくなった日があれば、その日を除いて送り直す
        if (err instanceof ApiClientError && err.code === "DATE_OUT_OF_RANGE") {
          const bad = new Set((err.details as { dates?: string[] } | undefined)?.dates ?? []);
          batch = Object.fromEntries(Object.entries(batch).filter(([d]) => !bad.has(d)));
          setNotice("入力できなくなった日(過ぎた日など)は保存されませんでした");
          res = await api.putAvailability(calendarId, secret, batch, keepalive);
        } else {
          throw err;
        }
      }
      // サーバーの最新の予定に、送っている間に増えた変更を重ねて表示する
      setEntries(applyChanges(res.availability, pending.current));
      optsRef.current.onSaved(res);
      setState(hasPending() ? "pending" : "saved");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        optsRef.current.onUnauthorized();
        return;
      }
      // 送れなかった分は戻しておき、あとでもう一度送る
      pending.current = { ...batch, ...pending.current };
      setState("error");
    } finally {
      inflight.current = false;
    }
    if (hasPending()) schedule();
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  /** 1日分を変える(画面にはすぐ反映し、保存は少しまとめてから) */
  const change = (date: string, entry: DayEntry | null) => {
    pending.current = { ...pending.current, [date]: entry };
    setEntries((prev) => applyChanges(prev, { [date]: entry }));
    setState("pending");
    schedule();
  };

  // 画面を閉じる・隠れるときは、まだ送っていない分をすぐ送る
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    const onPageHide = () => void flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      // アプリの中で別の画面へ移るとき(「卓に戻る」など)も、まだ送っていない分を送る
      void flush(true);
    };
  }, []);

  return { entries, state, notice, change, retry: () => void flush() };
}
