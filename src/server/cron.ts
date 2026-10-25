// 毎日1回の定期処理(spec.md 9.3)
// - 終わった卓を、予定を除いた軽い「記録」に切り替える(卓は消さない)
// - 1年使われていないカレンダーを削除する(卓には名前だけ残す)
// D1 の書き込み枠を一度に使い切らないよう、少しずつ処理する
import { addDays, jstNow } from "../shared/dates";

/** 卓を記録にするまでの日数(最後の日から) */
export const ARCHIVE_AFTER_DAYS = 90;
/** カレンダーを削除するまでの日数(最後に使った日から) */
export const DELETE_CALENDAR_AFTER_DAYS = 365;

export interface CleanupOptions {
  /** 1回に処理する件数 */
  batchSize?: number;
  /** 1日にくり返す回数の上限 */
  maxRounds?: number;
}

export interface CleanupResult {
  archivedSessions: number;
  deletedCalendars: number;
  deletedFeedback: number;
}

/** 問い合わせ・評価を消すまでの日数 */
export const DELETE_FEEDBACK_AFTER_DAYS = 365;

/**
 * 終わった卓を記録にする。
 * 参加者の名前をその時点の名前で書き写してから、記録の印(archived_at)を付ける。
 * 2つの文は同じ条件で同じ卓を選ぶので、batch(全部成功か全部取り消し)で一緒に行う
 */
async function archiveSessions(db: D1Database, now: Date, opts: Required<CleanupOptions>): Promise<number> {
  const cutoff = addDays(jstNow(now).today, -ARCHIVE_AFTER_DAYS);
  const targets = `SELECT id FROM sessions WHERE archived_at IS NULL AND last_date < ?1 ORDER BY last_date, id LIMIT ?2`;
  let total = 0;
  for (let round = 0; round < opts.maxRounds; round++) {
    const [, marked] = await db.batch([
      db
        .prepare(
          `UPDATE participations SET display_name_snapshot = COALESCE(
             display_name_override,
             (SELECT display_name FROM calendars WHERE id = participations.calendar_id),
             display_name_snapshot)
           WHERE session_id IN (${targets})`,
        )
        .bind(cutoff, opts.batchSize),
      db
        .prepare(`UPDATE sessions SET archived_at = ?3 WHERE id IN (${targets})`)
        .bind(cutoff, opts.batchSize, now.toISOString()),
    ]);
    const changed = marked!.meta.changes;
    total += changed;
    if (changed < opts.batchSize) break;
  }
  return total;
}

/**
 * 1年使われていないカレンダーを削除する。
 * 先に、参加している卓へ名前を書き写す(すでに書き写した名前がある記録の卓は、そのまま残す)
 */
async function deleteOldCalendars(db: D1Database, now: Date, opts: Required<CleanupOptions>): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETE_CALENDAR_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const targets = `SELECT id FROM calendars WHERE last_accessed_at < ?1 ORDER BY last_accessed_at, id LIMIT ?2`;
  let total = 0;
  for (let round = 0; round < opts.maxRounds; round++) {
    // 消えた行の数には、連動して書き換わった参加情報も数えられることがあるので、
    // 消す前に対象の件数を数えておく
    const [counted] = await db.batch([
      db.prepare(`SELECT count(*) AS n FROM (${targets})`).bind(cutoff, opts.batchSize),
      db
        .prepare(
          `UPDATE participations SET display_name_snapshot = COALESCE(
             display_name_snapshot,
             (SELECT display_name FROM calendars WHERE id = participations.calendar_id))
           WHERE calendar_id IN (${targets})`,
        )
        .bind(cutoff, opts.batchSize),
      db.prepare(`DELETE FROM calendars WHERE id IN (${targets})`).bind(cutoff, opts.batchSize),
    ]);
    const n = (counted!.results as { n: number }[])[0]!.n;
    total += n;
    if (n < opts.batchSize) break;
  }
  return total;
}

/** 1年たった問い合わせ・評価を消す(返信先などの個人情報を長く持たないため) */
async function deleteOldFeedback(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETE_FEEDBACK_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await db.prepare("DELETE FROM feedback WHERE created_at < ?1").bind(cutoff).run();
  return res.meta.changes;
}

/** 毎日の定期処理の本体 */
export async function runDailyCleanup(
  db: D1Database,
  now: Date = new Date(),
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const opts = { batchSize: options.batchSize ?? 500, maxRounds: options.maxRounds ?? 10 };
  const archivedSessions = await archiveSessions(db, now, opts);
  const deletedCalendars = await deleteOldCalendars(db, now, opts);
  const deletedFeedback = await deleteOldFeedback(db, now);
  // ログには件数だけを残す(ID や名前は出さない)
  console.log(JSON.stringify({ job: "daily-cleanup", archivedSessions, deletedCalendars, deletedFeedback }));
  return { archivedSessions, deletedCalendars, deletedFeedback };
}
