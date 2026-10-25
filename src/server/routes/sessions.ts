// 卓の API(spec.md 5.6)
import type { Context } from "hono";
import { Hono } from "hono";
import { acceptedRange } from "../../shared/dates";
import { ID_PATTERNS, newParticipationId, newSessionId } from "../../shared/ids";
import {
  CreateSession,
  JoinSession,
  LIMITS,
  PatchParticipant,
  PatchSession,
} from "../../shared/schema";
import type { ParticipantResponse } from "../../shared/types";
import { readBearer, requireCalendar, sha256Hex, touchAccess, type AuthedCalendar } from "../auth";
import * as db from "../db-sessions";
import { ApiError, Errors, readBody } from "../errors";
import { rateLimit } from "../ratelimit";
import type { AppEnv } from "../types";

export const sessions = new Hono<AppEnv>();

const archivedError = () =>
  new ApiError(409, "SESSION_ARCHIVED", "この卓は記録として保存されているため、変更できません");
const lastGmError = () =>
  new ApiError(409, "LAST_GM", "GMがいなくなってしまうため、この操作はできません。先にほかの人をGMにしてください");

/** 入力できない日付があれば 422(details.dates に一覧) */
function assertDatesInRange(dates: string[]): void {
  const { from, to } = acceptedRange();
  const out = dates.filter((d) => d < from || d > to).sort();
  if (out.length > 0) {
    throw new ApiError(422, "DATE_OUT_OF_RANGE", "選べない日付が含まれています", { dates: out });
  }
}

/** パスの卓IDの形を確かめる。違えば「見つからない」と同じ扱い */
function sessionIdParam(c: Context<AppEnv>): string {
  const id = c.req.param("id")!;
  if (!ID_PATTERNS.session.test(id)) throw Errors.notFound();
  return id;
}

/**
 * 秘密が必要な卓の操作の前準備。
 * 見ている人のカレンダー(401)→ 卓(404)→ その卓での参加情報(参加していなければ null)
 */
async function loadForAction(c: Context<AppEnv>) {
  const cal = await requireCalendar(c);
  const bundle = await db.loadSession(c.env.DB, sessionIdParam(c));
  if (!bundle) throw Errors.notFound();
  const actor = bundle.participants.find((p) => p.calendar_id === cal.id) ?? null;
  return { cal, bundle, actor, isGm: actor?.role === "GM" };
}

async function respondSession(c: Context<AppEnv>, sessionId: string, viewer: AuthedCalendar, status: 200 | 201 = 200) {
  const bundle = (await db.loadSession(c.env.DB, sessionId))!;
  return c.json(db.toSessionResponse(bundle, viewer.id), status);
}

// 作成(作成者は GM として自動で参加する)
sessions.post("/", rateLimit("RL_CREATE"), async (c) => {
  const cal = await requireCalendar(c);
  const body = await readBody(c, CreateSession);
  const candidateDates = [...body.candidateDates].sort();
  assertDatesInRange(candidateDates);

  const id = newSessionId();
  await db.insertSession(c.env.DB, {
    id,
    title: body.title,
    candidateDates,
    participationId: newParticipationId(),
    calendarId: cal.id,
    displayName: body.displayName ?? null,
    now: new Date().toISOString(),
  });
  return respondSession(c, id, cal, 201);
});

// 取得(秘密は任意。あれば me が入る)
sessions.get("/:id", rateLimit("RL_READ"), async (c) => {
  const id = sessionIdParam(c);
  const hasHeader = c.req.header("Authorization") !== undefined;
  const secret = readBearer(c);
  if (hasHeader && !secret) throw Errors.unauthorized();

  const bundle = await db.loadSession(c.env.DB, id, secret ? await sha256Hex(secret) : undefined);
  if (!bundle) throw Errors.notFound();
  if (secret && !bundle.viewer) throw Errors.unauthorized();
  if (bundle.viewer) touchAccess(c, bundle.viewer.id, bundle.viewer.last_accessed_at);
  return c.json(db.toSessionResponse(bundle, bundle.viewer?.id ?? null));
});

// タイトル・候補日・確定日の変更(GM だけ)
sessions.patch("/:id", rateLimit("RL_WRITE"), async (c) => {
  const { cal, bundle, isGm } = await loadForAction(c);
  if (!isGm) throw Errors.forbidden("卓の内容を変えられるのはGMだけです");
  if (bundle.session.archived_at !== null) throw archivedError();
  const body = await readBody(c, PatchSession);

  const currentDates = JSON.parse(bundle.session.candidate_dates) as string[];
  const candidateDates = body.candidateDates ? [...body.candidateDates].sort() : currentDates;
  // 範囲のチェックは、新しく足した日だけ(すでにある過去の候補日は残してよい)
  assertDatesInRange(candidateDates.filter((d) => !currentDates.includes(d)));

  const confirmedDate =
    body.confirmedDate === undefined ? bundle.session.confirmed_date : body.confirmedDate;
  if (confirmedDate !== null && !candidateDates.includes(confirmedDate)) {
    throw new ApiError(
      422,
      "CONFIRMED_DATE_NOT_IN_CANDIDATES",
      "開催日は候補日の中から選んでください。開催日を候補日から外すときは、先に開催日の決定を取り消してください",
    );
  }

  const updated = await db.updateSession(c.env.DB, bundle.session.id, {
    title: body.title ?? bundle.session.title,
    candidateDates,
    confirmedDate,
    now: new Date().toISOString(),
  });
  if (!updated) throw archivedError();
  return respondSession(c, bundle.session.id, cal);
});

// 卓の削除(GM だけ。記録になった卓も削除できる)
sessions.delete("/:id", rateLimit("RL_WRITE"), async (c) => {
  const { bundle, isGm } = await loadForAction(c);
  if (!isGm) throw Errors.forbidden("卓を削除できるのはGMだけです");
  await db.deleteSession(c.env.DB, bundle.session.id);
  return c.body(null, 204);
});

// 参加(必ず PL)。本人の秘密か、共有トークンのどちらか
sessions.post("/:id/participants", rateLimit("RL_WRITE"), async (c) => {
  const sessionId = sessionIdParam(c);
  const body = await readBody(c, JoinSession);
  const hasHeader = c.req.header("Authorization") !== undefined;
  if (hasHeader && body.shareToken) {
    throw new ApiError(400, "INVALID_REQUEST", "秘密と参加用トークンは、どちらか一方だけを送ってください");
  }

  let calendarId: string;
  if (hasHeader) {
    calendarId = (await requireCalendar(c)).id;
  } else if (body.shareToken) {
    calendarId = await resolveShareToken(c, body.shareToken);
  } else {
    throw Errors.unauthorized();
  }

  const session = await c.env.DB.prepare("SELECT archived_at FROM sessions WHERE id = ?1")
    .bind(sessionId)
    .first<{ archived_at: string | null }>();
  if (!session) throw Errors.notFound();
  if (session.archived_at !== null) throw archivedError();

  const id = newParticipationId();
  const result = await db.insertParticipant(c.env.DB, {
    id,
    sessionId,
    calendarId,
    displayName: body.displayName ?? null,
    now: new Date().toISOString(),
    max: LIMITS.participants,
  });
  switch (result) {
    case "joined":
      return c.json({ id, role: "PL" as const }, 201);
    case "already_joined":
      throw new ApiError(409, "ALREADY_JOINED", "このカレンダーは、すでにこの卓に参加しています");
    case "full":
      throw new ApiError(409, "SESSION_FULL", `この卓は${LIMITS.participants}人までです`);
    case "archived":
      throw archivedError();
  }
});

/** 共有トークンからカレンダーを特定する。期限切れ・再発行前のものは 401 */
async function resolveShareToken(c: Context<AppEnv>, token: string): Promise<string> {
  const stored = await c.env.SHARE_TOKENS.get<{ calendarId: string; generation: number }>(token, "json");
  if (!stored) throw Errors.shareTokenInvalid();
  const row = await c.env.DB.prepare("SELECT token_generation FROM calendars WHERE id = ?1")
    .bind(stored.calendarId)
    .first<{ token_generation: number }>();
  if (!row || row.token_generation !== stored.generation) throw Errors.shareTokenInvalid();
  return stored.calendarId;
}

/** パスの参加IDの参加者を、その卓の中から探す */
function findTarget(bundle: db.SessionBundle, c: Context<AppEnv>): db.ParticipantRow {
  const pid = c.req.param("pid")!;
  const target = ID_PATTERNS.participation.test(pid)
    ? bundle.participants.find((p) => p.id === pid)
    : undefined;
  if (!target) throw Errors.notFound();
  return target;
}

// 役割・この卓での名前の変更
sessions.patch("/:id/participants/:pid", rateLimit("RL_WRITE"), async (c) => {
  const { cal, bundle, isGm } = await loadForAction(c);
  const target = findTarget(bundle, c);
  if (bundle.session.archived_at !== null) throw archivedError();
  const body = await readBody(c, PatchParticipant);

  // 書き込む前に、権限をすべて確かめる
  if (body.role !== undefined && !isGm) throw Errors.forbidden("役割を変えられるのはGMだけです");
  if (body.displayName !== undefined && !isGm && target.calendar_id !== cal.id) {
    throw Errors.forbidden("ほかの人の名前は変えられません");
  }
  if (body.role === "GM" && target.calendar_id === null) {
    throw Errors.validation("カレンダーが削除された参加者はGMにできません");
  }

  if (body.role !== undefined) {
    const result = await db.updateRole(c.env.DB, target.id, bundle.session.id, body.role);
    if (result === "archived") throw archivedError();
    if (result === "last_gm") throw lastGmError();
  }
  if (body.displayName !== undefined) {
    // 記録になっていない卓だけ変える(確かめてから書き込むまでの間に、記録になった場合も含めて)
    const changed = await db.updateParticipantName(c.env.DB, target.id, bundle.session.id, body.displayName);
    if (!changed) throw archivedError();
  }

  const after = (await db.loadSession(c.env.DB, bundle.session.id))!;
  const view = db.toSessionResponse(after, cal.id).participants.find((p) => p.id === target.id)!;
  const res: ParticipantResponse = { id: view.id, role: view.role, displayName: view.displayName };
  return c.json(res);
});

// 外す(GM)・抜ける(本人)
sessions.delete("/:id/participants/:pid", rateLimit("RL_WRITE"), async (c) => {
  const { cal, bundle, isGm } = await loadForAction(c);
  const target = findTarget(bundle, c);
  if (!isGm && target.calendar_id !== cal.id) throw Errors.forbidden("ほかの人を外せるのはGMだけです");
  if (bundle.session.archived_at !== null) throw archivedError();
  const result = await db.deleteParticipant(c.env.DB, target.id, bundle.session.id);
  if (result === "archived") throw archivedError();
  if (result === "last_gm") throw lastGmError();
  return c.body(null, 204);
});
