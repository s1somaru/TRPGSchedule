// 編集URLの秘密による本人確認(spec.md 5.3 / 7.4)
import type { Context } from "hono";
import { jstNow } from "../shared/dates";
import { ID_PATTERNS } from "../shared/ids";
import { Errors } from "./errors";
import type { AppEnv } from "./types";

export interface AuthedCalendar {
  id: string;
  tokenGeneration: number;
}

/** 文字列の SHA-256 を 16進数で返す。DB には秘密そのものではなくこれを保存する */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Authorization: Bearer <秘密> から秘密を取り出す。形が違えば null */
export function readBearer(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m || !ID_PATTERNS.secret.test(m[1]!)) return null;
  return m[1]!;
}

/** 秘密からカレンダーを探す。見つからなければ null */
export async function findCalendarBySecret(
  c: Context<AppEnv>,
  secret: string,
): Promise<AuthedCalendar | null> {
  const row = await c.env.DB.prepare(
    "SELECT id, token_generation, last_accessed_at FROM calendars WHERE edit_secret_hash = ?1",
  )
    .bind(await sha256Hex(secret))
    .first<{ id: string; token_generation: number; last_accessed_at: string }>();
  if (!row) return null;
  touchAccess(c, row.id, row.last_accessed_at);
  return { id: row.id, tokenGeneration: row.token_generation };
}

/**
 * パスのカレンダーの本人であることを確かめる。
 * 「カレンダーがない」と「秘密が違う」は区別せず、どちらも 401 にする
 */
export async function requireOwner(c: Context<AppEnv>, calendarId: string): Promise<AuthedCalendar> {
  const secret = readBearer(c);
  if (!secret || !ID_PATTERNS.calendar.test(calendarId)) throw Errors.unauthorized();
  const cal = await findCalendarBySecret(c, secret);
  if (!cal || cal.id !== calendarId) throw Errors.unauthorized();
  return cal;
}

/** 最後に使った日時を記録する。書き込みを減らすため、同じ日(日本時間)の2回目以降はしない */
function touchAccess(c: Context<AppEnv>, calendarId: string, lastAccessedAt: string): void {
  const now = new Date();
  if (jstNow(new Date(lastAccessedAt)).today === jstNow(now).today) return;
  const task = c.env.DB.prepare("UPDATE calendars SET last_accessed_at = ?1 WHERE id = ?2")
    .bind(now.toISOString(), calendarId)
    .run()
    .catch(() => {
      // 記録に失敗しても本来の操作は止めない
    });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // テストなどで実行コンテキストがない場合は、そのまま進める
  }
}
