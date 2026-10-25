// 卓まわりの DB 操作(spec.md 5.6 / 7.1 / 8.1)。
// 「最後のGMか」「30人を超えるか」などの条件は、書き込む SQL 文の中に入れて、
// 同時に操作されても食い違わないようにする
import type { Availability, ParticipantView, Role, SessionResponse } from "../shared/types";

export interface SessionRow {
  id: string;
  title: string;
  candidate_dates: string;
  confirmed_dates: string;
  archived_at: string | null;
}

export interface ParticipantRow {
  id: string;
  role: Role;
  joined_at: string;
  calendar_id: string | null;
  display_name_override: string | null;
  display_name_snapshot: string | null;
  calendar_name: string | null;
  availability: string | null;
}

export interface SessionBundle {
  session: SessionRow;
  participants: ParticipantRow[];
  /** 秘密つきで読んだときの、そのカレンダー(見つからなければ null) */
  viewer: { id: string; last_accessed_at: string } | null;
}

const SELECT_SESSION =
  "SELECT id, title, candidate_dates, confirmed_dates, archived_at FROM sessions WHERE id = ?1";

const SELECT_PARTICIPANTS = `
  SELECT p.id, p.role, p.joined_at, p.calendar_id, p.display_name_override, p.display_name_snapshot,
         c.display_name AS calendar_name,
         -- 予定は、この卓の候補日に当たる日だけを取り出す(全期間を Worker に運ばない)
         (SELECT json_group_object(key, json(value)) FROM json_each(c.availability)
          WHERE key IN (SELECT value FROM json_each((SELECT candidate_dates FROM sessions WHERE id = ?1)))
         ) AS availability
  FROM participations p LEFT JOIN calendars c ON c.id = p.calendar_id
  WHERE p.session_id = ?1
  ORDER BY (p.role = 'GM') DESC, p.joined_at, p.id`;

/** その卓が記録になっていないこと(SQL の中で使う。?2 = 卓ID) */
const NOT_ARCHIVED = `EXISTS (SELECT 1 FROM sessions WHERE id = ?2 AND archived_at IS NULL)`;

/** カレンダーが残っているGMの人数(SQL の中で使う) */
const ACTIVE_GM_COUNT = `
  (SELECT count(*) FROM participations g JOIN calendars gc ON gc.id = g.calendar_id
   WHERE g.session_id = ?2 AND g.role = 'GM')`;

/**
 * 卓・参加者(と予定)・見ている人のカレンダーを、1往復でまとめて読む(spec.md 4.1)
 */
export async function loadSession(
  db: D1Database,
  sessionId: string,
  viewerSecretHash?: string,
): Promise<SessionBundle | null> {
  const stmts = [
    db.prepare(SELECT_SESSION).bind(sessionId),
    db.prepare(SELECT_PARTICIPANTS).bind(sessionId),
  ];
  if (viewerSecretHash) {
    stmts.push(
      db
        .prepare("SELECT id, last_accessed_at FROM calendars WHERE edit_secret_hash = ?1")
        .bind(viewerSecretHash),
    );
  }
  const [s, p, v] = await db.batch(stmts);
  const session = (s!.results as SessionRow[])[0];
  if (!session) return null;
  return {
    session,
    participants: p!.results as ParticipantRow[],
    viewer: v ? ((v.results as SessionBundle["viewer"][])[0] ?? null) : null,
  };
}

/** 参加者の表示名。記録になった卓は書き写した名前を優先する */
function displayNameOf(row: ParticipantRow, archived: boolean): string {
  if (archived) {
    return row.display_name_snapshot ?? row.display_name_override ?? row.calendar_name ?? "";
  }
  return row.display_name_override ?? row.calendar_name ?? row.display_name_snapshot ?? "";
}

/** DB の形を API の形にする。予定は候補日に当たる日だけに絞る。calendarId は返さない */
export function toSessionResponse(bundle: SessionBundle, viewerCalendarId: string | null): SessionResponse {
  const { session } = bundle;
  const archived = session.archived_at !== null;
  const candidateDates = JSON.parse(session.candidate_dates) as string[];

  const participants: ParticipantView[] = bundle.participants.map((row) => {
    const showSchedule = !archived && row.calendar_id !== null && row.availability !== null;
    const availability: Availability = {};
    if (showSchedule) {
      const all = JSON.parse(row.availability!) as Availability;
      for (const date of candidateDates) {
        if (all[date]) availability[date] = all[date];
      }
    }
    return {
      id: row.id,
      role: row.role,
      displayName: displayNameOf(row, archived),
      calendarDeleted: row.calendar_id === null,
      availability,
    };
  });

  const mine = viewerCalendarId
    ? bundle.participants.filter((p) => p.calendar_id === viewerCalendarId)[0]
    : undefined;

  return {
    id: session.id,
    title: session.title,
    candidateDates,
    confirmedDates: JSON.parse(session.confirmed_dates) as string[],
    archived,
    participants,
    me: mine ? { participantId: mine.id, role: mine.role } : null,
  };
}

/** 卓を作り、作成者をGMとして参加させる */
export async function insertSession(
  db: D1Database,
  args: {
    id: string;
    title: string;
    candidateDates: string[];
    participationId: string;
    calendarId: string;
    displayName: string | null;
    now: string;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (id, title, candidate_dates, confirmed_dates, last_date, archived_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, '[]', ?4, NULL, ?5, ?5)`,
      )
      .bind(
        args.id,
        args.title,
        JSON.stringify(args.candidateDates),
        args.candidateDates[args.candidateDates.length - 1],
        args.now,
      ),
    db
      .prepare(
        `INSERT INTO participations (id, session_id, calendar_id, role, display_name_override, joined_at)
         VALUES (?1, ?2, ?3, 'GM', ?4, ?5)`,
      )
      .bind(args.participationId, args.id, args.calendarId, args.displayName, args.now),
  ]);
}

/** 卓の内容を変える。記録になっていた場合は false */
export async function updateSession(
  db: D1Database,
  id: string,
  next: { title: string; candidateDates: string[]; confirmedDates: string[]; now: string },
): Promise<boolean> {
  // 記録に切り替える基準の日:開催日があれば一番遅い開催日、なければ最後の候補日
  const lastDate =
    next.confirmedDates[next.confirmedDates.length - 1] ?? next.candidateDates[next.candidateDates.length - 1]!;
  const res = await db
    .prepare(
      `UPDATE sessions SET title = ?1, candidate_dates = ?2, confirmed_dates = ?3, last_date = ?4, updated_at = ?5
       WHERE id = ?6 AND archived_at IS NULL`,
    )
    .bind(next.title, JSON.stringify(next.candidateDates), JSON.stringify(next.confirmedDates), lastDate, next.now, id)
    .run();
  return res.meta.changes > 0;
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  // 参加情報は、テーブルの設定(ON DELETE CASCADE)で一緒に消える
  await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
}

export type JoinResult = "joined" | "already_joined" | "full" | "archived";

/** 参加(必ず PL)。30人未満で、記録になっていないときだけ入る */
export async function insertParticipant(
  db: D1Database,
  args: { id: string; sessionId: string; calendarId: string; displayName: string | null; now: string; max: number },
): Promise<JoinResult> {
  let changes: number;
  try {
    const res = await db
      .prepare(
        `INSERT INTO participations (id, session_id, calendar_id, role, display_name_override, joined_at)
         SELECT ?1, ?2, ?3, 'PL', ?4, ?5
         WHERE (SELECT count(*) FROM participations WHERE session_id = ?2) < ?6
           AND EXISTS (SELECT 1 FROM sessions WHERE id = ?2 AND archived_at IS NULL)`,
      )
      .bind(args.id, args.sessionId, args.calendarId, args.displayName, args.now, args.max)
      .run();
    changes = res.meta.changes;
  } catch (e) {
    // 同じカレンダーの二重参加は、テーブルの UNIQUE 制約で弾かれる
    if (e instanceof Error && e.message.includes("UNIQUE")) return "already_joined";
    throw e;
  }
  if (changes > 0) return "joined";
  const row = await db
    .prepare("SELECT archived_at FROM sessions WHERE id = ?1")
    .bind(args.sessionId)
    .first<{ archived_at: string | null }>();
  return row && row.archived_at !== null ? "archived" : "full";
}

export type RoleResult = "ok" | "last_gm" | "archived";

/**
 * 役割を変える。記録になっていない卓だけ。
 * PL にするときは「カレンダーが残っているGMが2人以上いる」ときだけ成功する
 * (カレンダーが削除されたGMは、人数に関係なく PL にできる)
 */
export async function updateRole(
  db: D1Database,
  participantId: string,
  sessionId: string,
  role: Role,
): Promise<RoleResult> {
  const sql =
    role === "PL"
      ? `UPDATE participations SET role = 'PL'
         WHERE id = ?1 AND session_id = ?2 AND role = 'GM' AND ${NOT_ARCHIVED}
           AND (calendar_id IS NULL OR ${ACTIVE_GM_COUNT} > 1)`
      : `UPDATE participations SET role = 'GM' WHERE id = ?1 AND session_id = ?2 AND ${NOT_ARCHIVED}`;
  const res = await db.prepare(sql).bind(participantId, sessionId).run();
  if (res.meta.changes > 0) return "ok";
  // 変わらなかった理由を調べる
  const row = await db
    .prepare(
      `SELECT p.role, s.archived_at FROM participations p JOIN sessions s ON s.id = p.session_id
       WHERE p.id = ?1 AND p.session_id = ?2`,
    )
    .bind(participantId, sessionId)
    .first<{ role: Role; archived_at: string | null }>();
  if (!row || row.archived_at !== null) return "archived";
  // すでに PL の人を PL にする場合は、変わる行がなくても成功とみなす
  return role === "PL" && row.role === "PL" ? "ok" : "last_gm";
}

/** この卓での名前を変える。記録になっていない卓だけ。変えたら true */
export async function updateParticipantName(
  db: D1Database,
  participantId: string,
  sessionId: string,
  displayName: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE participations SET display_name_override = ?3
       WHERE id = ?1 AND session_id = ?2 AND ${NOT_ARCHIVED}`,
    )
    .bind(participantId, sessionId, displayName)
    .run();
  return res.meta.changes > 0;
}

export type RemoveResult = "ok" | "last_gm" | "archived";

/** 外す・抜ける。記録になっていない卓だけ。カレンダーが残っている最後のGMは消さない */
export async function deleteParticipant(
  db: D1Database,
  participantId: string,
  sessionId: string,
): Promise<RemoveResult> {
  const res = await db
    .prepare(
      `DELETE FROM participations
       WHERE id = ?1 AND session_id = ?2 AND ${NOT_ARCHIVED}
         AND NOT (role = 'GM' AND calendar_id IS NOT NULL AND ${ACTIVE_GM_COUNT} <= 1)`,
    )
    .bind(participantId, sessionId)
    .run();
  if (res.meta.changes > 0) return "ok";
  const row = await db
    .prepare("SELECT archived_at FROM sessions WHERE id = ?1")
    .bind(sessionId)
    .first<{ archived_at: string | null }>();
  return !row || row.archived_at !== null ? "archived" : "last_gm";
}
