// カレンダーまわりの DB 操作。
// SQL は必ず prepare(...).bind(...) で書き、入力を SQL の文字列につなげない(spec.md 7.1)
import { inputRange, pastCutoff } from "../shared/dates";
import { MAX_AVAILABILITY_CHARS } from "../shared/limits";
import type { Availability, CalendarResponse, DayEntry } from "../shared/types";

export interface CalendarRow {
  id: string;
  display_name: string;
  availability: string;
  last_updated_at: string;
  last_accessed_at: string;
}

const COLUMNS = "id, display_name, availability, last_updated_at, last_accessed_at";
const SELECT_CALENDAR = `SELECT ${COLUMNS} FROM calendars WHERE id = ?1`;
/** 本人確認つきで読む(ID と秘密のハッシュの両方が一致する行だけ) */
const SELECT_OWNED = `SELECT ${COLUMNS} FROM calendars WHERE id = ?1 AND edit_secret_hash = ?2`;

/** DB の行を API の形にする。90日より前の予定は返さない */
export function toCalendarResponse(row: CalendarRow, now = new Date()): CalendarResponse {
  const cutoff = pastCutoff(now);
  const all = JSON.parse(row.availability) as Availability;
  const availability: Availability = {};
  for (const date of Object.keys(all).sort()) {
    if (date >= cutoff) availability[date] = all[date]!;
  }
  return {
    id: row.id,
    displayName: row.display_name,
    availability,
    inputRange: inputRange(now),
    lastUpdatedAt: row.last_updated_at,
  };
}

export async function getCalendar(db: D1Database, id: string): Promise<CalendarResponse | null> {
  const row = await db.prepare(SELECT_CALENDAR).bind(id).first<CalendarRow>();
  return row ? toCalendarResponse(row) : null;
}

/** 本人確認と読み込みを1回の問い合わせで行う。違えば null */
export async function getOwnedCalendar(db: D1Database, id: string, secretHash: string): Promise<CalendarRow | null> {
  return db.prepare(SELECT_OWNED).bind(id, secretHash).first<CalendarRow>();
}

export async function insertCalendar(
  db: D1Database,
  args: { id: string; secretHash: string; displayName: string; now: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO calendars (id, edit_secret_hash, display_name, availability, created_at, last_updated_at, last_accessed_at)
       VALUES (?1, ?2, ?3, '{}', ?4, ?4, ?4)`,
    )
    .bind(args.id, args.secretHash, args.displayName, args.now)
    .run();
}

/** 表示名を変える。本人確認も同じ1往復で行う。秘密が違えば null */
export async function updateDisplayName(
  db: D1Database,
  id: string,
  secretHash: string,
  displayName: string,
  now: string,
): Promise<CalendarRow | null> {
  const [, selected] = await db.batch([
    db
      .prepare("UPDATE calendars SET display_name = ?1, last_updated_at = ?2 WHERE id = ?3 AND edit_secret_hash = ?4")
      .bind(displayName, now, id, secretHash),
    db.prepare(SELECT_OWNED).bind(id, secretHash),
  ]);
  return (selected!.results as CalendarRow[])[0] ?? null;
}

/** 今の予定に変更分(?1)を混ぜた結果。90日より前(?2)の日は捨てる */
const MERGED = `(
  SELECT COALESCE(json_group_object(key, json(value)), '{}') FROM (
    SELECT key, value FROM json_each(calendars.availability)
     WHERE key >= ?2 AND key NOT IN (SELECT key FROM json_each(?1))
    UNION ALL
    SELECT key, value FROM json_each(?1) WHERE type <> 'null'
    ORDER BY key
  )
)`;

export type MergeResult = { kind: "ok"; row: CalendarRow } | { kind: "unauthorized" } | { kind: "too_large" };

/**
 * 予定を更新する。同時に保存しても片方が消えないよう、1つの SQL 文で「混ぜて書く」(spec.md 7.1)。
 * - 送られた日は1日分を丸ごと置き換える(null の日は消す)
 * - 90日より前の日も、ついでに消す
 * - 混ぜた結果が大きすぎるときは保存しない(とても大きなデータで卓ページを重くされないように)
 * - 本人確認(ID と秘密のハッシュ)も同じ文の条件に入れ、1往復で済ませる
 * 日数がいくつでも、渡す値は数個だけなので、D1 の「1文あたりの値は100個まで」という制限にもかからない
 */
export async function mergeAvailability(
  db: D1Database,
  id: string,
  secretHash: string,
  changes: Record<string, DayEntry | null>,
  now: Date,
): Promise<MergeResult> {
  const [updated, selected] = await db.batch([
    db
      .prepare(
        `UPDATE calendars SET availability = ${MERGED}, last_updated_at = ?3
         WHERE id = ?4 AND edit_secret_hash = ?5 AND length(${MERGED}) <= ?6`,
      )
      .bind(JSON.stringify(changes), pastCutoff(now), now.toISOString(), id, secretHash, MAX_AVAILABILITY_CHARS),
    db.prepare(SELECT_OWNED).bind(id, secretHash),
  ]);
  const row = (selected!.results as CalendarRow[])[0];
  if (!row) return { kind: "unauthorized" };
  if (updated!.meta.changes === 0) return { kind: "too_large" };
  return { kind: "ok", row };
}

/** 自分が唯一のGMをしている、記録になっていない卓 */
const SOLE_GM_SESSIONS = `
  SELECT s.id, s.title FROM participations p JOIN sessions s ON s.id = p.session_id
  WHERE p.calendar_id = ?1 AND p.role = 'GM' AND s.archived_at IS NULL
    AND (SELECT count(*) FROM participations p2 JOIN calendars c2 ON c2.id = p2.calendar_id
         WHERE p2.session_id = s.id AND p2.role = 'GM') = 1`;

/**
 * カレンダーを削除する。唯一のGMをしている卓があれば削除せず、その卓の一覧を返す。
 * 「確かめてから消す」の間に状況が変わっても食い違わないよう、条件は DELETE 文の中に入れる
 */
export async function deleteCalendar(
  db: D1Database,
  id: string,
): Promise<{ deleted: true } | { deleted: false; soleGmOf: { id: string; title: string }[] }> {
  const [, deleted] = await db.batch([
    // 卓に名前が残るよう、先に書き写しておく。
    // - 削除と同じ条件を付け、削除が断られたときは書き写さない(あとで名前を変えたとき、古い名前が残らないように)
    // - 記録の卓にすでに書き写してある名前(卓ごとの名前など)は、上書きしない
    db
      .prepare(
        `UPDATE participations
         SET display_name_snapshot = COALESCE(display_name_snapshot, (SELECT display_name FROM calendars WHERE id = ?1))
         WHERE calendar_id = ?1 AND NOT EXISTS (${SOLE_GM_SESSIONS})`,
      )
      .bind(id),
    db
      .prepare(`DELETE FROM calendars WHERE id = ?1 AND NOT EXISTS (${SOLE_GM_SESSIONS})`)
      .bind(id),
  ]);
  // 消えた行の数には、連動して書き換わった参加情報も数えられることがあるので「1件以上」で判断する
  if (deleted!.meta.changes > 0) return { deleted: true };
  const { results } = await db.prepare(SOLE_GM_SESSIONS).bind(id).all<{ id: string; title: string }>();
  return { deleted: false, soleGmOf: results };
}

/** 再発行:古い秘密が今のものと一致するときだけ置き換える。置き換えたら true */
export async function replaceSecret(
  db: D1Database,
  id: string,
  oldHash: string,
  newHash: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE calendars SET edit_secret_hash = ?1, token_generation = token_generation + 1
       WHERE id = ?2 AND edit_secret_hash = ?3`,
    )
    .bind(newHash, id, oldHash)
    .run();
  return res.meta.changes === 1;
}

export async function currentSecretHash(db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT edit_secret_hash FROM calendars WHERE id = ?1")
    .bind(id)
    .first<{ edit_secret_hash: string }>();
  return row?.edit_secret_hash ?? null;
}

export interface MySessionRow {
  id: string;
  title: string;
  candidate_dates: string;
  confirmed_dates: string;
  archived_at: string | null;
  role: "GM" | "PL";
}

export async function listMySessions(db: D1Database, calendarId: string): Promise<MySessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.title, s.candidate_dates, s.confirmed_dates, s.archived_at, p.role
       FROM participations p JOIN sessions s ON s.id = p.session_id
       WHERE p.calendar_id = ?1`,
    )
    .bind(calendarId)
    .all<MySessionRow>();
  return results;
}
