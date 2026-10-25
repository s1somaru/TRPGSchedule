// この端末で開いたものの履歴(spec.md 6.4)。
// ブックマークのような便利機能で、本人確認ではない。読めない・書けない環境でも画面は動くようにする
import { ID_PATTERNS } from "../shared/ids";

const KEY = "trpg-schedule:v1";
const MAX_ITEMS = 20;

export interface StoredCalendar {
  id: string;
  secret: string;
  /** 編集URLの作り直しの途中なら、新しい秘密(spec.md 3.11) */
  pendingSecret: string | null;
  displayName: string;
  lastOpenedAt: string;
}

export interface StoredSession {
  id: string;
  title: string;
  lastOpenedAt: string;
}

interface Stored {
  calendars: StoredCalendar[];
  sessions: StoredSession[];
}

const empty = (): Stored => ({ calendars: [], sessions: [] });

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw) as Partial<Stored>;
    // 壊れた値や、形の違う値は捨てる
    return {
      calendars: (data.calendars ?? []).filter(
        (c) => ID_PATTERNS.calendar.test(c.id) && ID_PATTERNS.secret.test(c.secret),
      ),
      sessions: (data.sessions ?? []).filter((s) => ID_PATTERNS.session.test(s.id)),
    };
  } catch {
    return empty();
  }
}

function write(data: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 保存できない環境(プライベートブラウズなど)では、覚えないだけにする
  }
}

const byRecent = <T extends { lastOpenedAt: string }>(a: T, b: T) =>
  b.lastOpenedAt.localeCompare(a.lastOpenedAt);

export const storage = {
  calendars(): StoredCalendar[] {
    return read().calendars.sort(byRecent);
  },

  sessions(): StoredSession[] {
    return read().sessions.sort(byRecent);
  },

  findCalendar(id: string): StoredCalendar | undefined {
    return read().calendars.find((c) => c.id === id);
  },

  /** カレンダーを開いたときに覚える(秘密が変わっていれば新しいほうにする) */
  rememberCalendar(entry: { id: string; secret: string; displayName: string }): void {
    const data = read();
    const old = data.calendars.find((c) => c.id === entry.id);
    const next: StoredCalendar = {
      ...entry,
      pendingSecret: old && old.secret === entry.secret ? old.pendingSecret : null,
      lastOpenedAt: new Date().toISOString(),
    };
    data.calendars = [next, ...data.calendars.filter((c) => c.id !== entry.id)]
      .sort(byRecent)
      .slice(0, MAX_ITEMS);
    write(data);
  },

  rememberSession(entry: { id: string; title: string }): void {
    const data = read();
    data.sessions = [
      { ...entry, lastOpenedAt: new Date().toISOString() },
      ...data.sessions.filter((s) => s.id !== entry.id),
    ]
      .sort(byRecent)
      .slice(0, MAX_ITEMS);
    write(data);
  },

  /** 作り直しの途中として、新しい秘密を先に保存する */
  setPendingSecret(id: string, pendingSecret: string | null): void {
    const data = read();
    const cal = data.calendars.find((c) => c.id === id);
    if (!cal) return;
    cal.pendingSecret = pendingSecret;
    write(data);
  },

  /** 作り直しが終わったので、新しい秘密を正式なものにする */
  promotePendingSecret(id: string): void {
    const data = read();
    const cal = data.calendars.find((c) => c.id === id);
    if (!cal || !cal.pendingSecret) return;
    cal.secret = cal.pendingSecret;
    cal.pendingSecret = null;
    write(data);
  },

  forgetCalendar(id: string): void {
    const data = read();
    data.calendars = data.calendars.filter((c) => c.id !== id);
    write(data);
  },

  forgetSession(id: string): void {
    const data = read();
    data.sessions = data.sessions.filter((s) => s.id !== id);
    write(data);
  },

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 何もしない
    }
  },
};

/** 編集URL(秘密は # の後ろ。サーバーやログに届かない) */
export function editUrl(id: string, secret: string): string {
  return `${location.origin}/c/${id}#${secret}`;
}
