// 個人カレンダーの API(spec.md 5.5)
import { Hono } from "hono";
import { acceptedRange, jstNow } from "../../shared/dates";
import { ID_PATTERNS, newCalendarId, newSecret } from "../../shared/ids";
import {
  AvailabilityUpdate,
  CreateCalendar,
  PatchCalendar,
  ReissueSecret,
} from "../../shared/schema";
import type {
  CalendarCreatedResponse,
  MySessionsResponse,
  PastSessionSummary,
  MySessionSummary,
} from "../../shared/types";
import { ownerSecretHash, readBearer, requireOwner, sha256Hex, touchAccess } from "../auth";
import * as db from "../db";
import { ApiError, Errors, readBody } from "../errors";
import { rateLimit } from "../ratelimit";
import type { AppEnv } from "../types";

export const calendars = new Hono<AppEnv>();

// 作成
calendars.post("/", rateLimit("RL_CREATE"), async (c) => {
  const { displayName } = await readBody(c, CreateCalendar);
  const id = newCalendarId();
  const editSecret = newSecret();
  await db.insertCalendar(c.env.DB, {
    id,
    secretHash: await sha256Hex(editSecret),
    displayName,
    now: new Date().toISOString(),
  });
  const cal = (await db.getCalendar(c.env.DB, id))!;
  // 秘密を返すのはこのときだけ
  const body: CalendarCreatedResponse = { ...cal, editSecret };
  return c.json(body, 201);
});

// 取得(本人確認と読み込みを1往復で)
calendars.get("/:id", rateLimit("RL_READ"), async (c) => {
  const id = c.req.param("id");
  const row = await db.getOwnedCalendar(c.env.DB, id, await ownerSecretHash(c, id));
  if (!row) throw Errors.unauthorized();
  touchAccess(c, row.id, row.last_accessed_at);
  return c.json(db.toCalendarResponse(row));
});

// 表示名・いつもの時間の変更(本人確認と書き込みを1往復で)
calendars.patch("/:id", rateLimit("RL_WRITE"), async (c) => {
  const id = c.req.param("id");
  const hash = await ownerSecretHash(c, id);
  const changes = await readBody(c, PatchCalendar);
  const row = await db.updateCalendarSettings(c.env.DB, id, hash, changes, new Date().toISOString());
  if (!row) throw Errors.unauthorized();
  touchAccess(c, row.id, row.last_accessed_at);
  return c.json(db.toCalendarResponse(row));
});

// 予定の更新(本人確認と書き込みを1往復で)
calendars.put("/:id/availability", rateLimit("RL_WRITE"), async (c) => {
  const id = c.req.param("id");
  const hash = await ownerSecretHash(c, id);
  const { availability } = await readBody(c, AvailabilityUpdate);
  const now = new Date();

  // 範囲外の日が1つでもあれば、全体を受け付けない(一部だけ保存されることを防ぐ)
  const { from, to } = acceptedRange(now);
  const outOfRange = Object.keys(availability).filter((d) => d < from || d > to).sort();
  if (outOfRange.length > 0) {
    throw new ApiError(422, "DATE_OUT_OF_RANGE", "入力できない日付が含まれています", {
      dates: outOfRange,
    });
  }
  if (Object.keys(availability).length === 0) {
    const row = await db.getOwnedCalendar(c.env.DB, id, hash);
    if (!row) throw Errors.unauthorized();
    return c.json(db.toCalendarResponse(row, now));
  }
  const result = await db.mergeAvailability(c.env.DB, id, hash, availability, now);
  if (result.kind === "unauthorized") throw Errors.unauthorized();
  if (result.kind === "too_large") {
    throw Errors.validation("予定が多すぎて保存できません。古いメモを減らしてください");
  }
  touchAccess(c, result.row.id, result.row.last_accessed_at);
  return c.json(db.toCalendarResponse(result.row, now));
});

// 削除
calendars.delete("/:id", rateLimit("RL_WRITE"), async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
  const result = await db.deleteCalendar(c.env.DB, id);
  if (!result.deleted) {
    throw new ApiError(
      409,
      "SOLE_GM_OF_SESSIONS",
      "あなたが唯一のGMをしている卓があります。先にほかの人をGMにするか、卓を削除してください",
      { sessions: result.soleGmOf },
    );
  }
  return c.body(null, 204);
});

// 編集URLの再発行(spec.md 3.11)。新しい秘密はフロントが作って送る
calendars.post("/:id/edit-secret", rateLimit("RL_WRITE"), async (c) => {
  const calendarId = c.req.param("id");
  const oldSecret = readBearer(c);
  if (!oldSecret || !ID_PATTERNS.calendar.test(calendarId)) throw Errors.unauthorized();
  const { newSecret: next } = await readBody(c, ReissueSecret);
  if (next === oldSecret) throw Errors.validation("新しい秘密が今のものと同じです");

  const newHash = await sha256Hex(next);
  if (await db.replaceSecret(c.env.DB, calendarId, await sha256Hex(oldSecret), newHash)) {
    return c.json({ ok: true });
  }
  // 応答が届かずにやり直した場合:すでに新しい秘密に置き換わっていれば成功として扱う
  if ((await db.currentSecretHash(c.env.DB, calendarId)) === newHash) {
    return c.json({ ok: true });
  }
  throw Errors.unauthorized();
});

// 参加中の卓と、これまでのセッション
calendars.get("/:id/sessions", rateLimit("RL_READ"), async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
  const rows = await db.listMySessions(c.env.DB, id);
  const { today } = jstNow();

  const active: (MySessionSummary & { sortKey: string })[] = [];
  const past: PastSessionSummary[] = [];
  for (const row of rows) {
    const dates = JSON.parse(row.candidate_dates) as string[];
    const confirmed = JSON.parse(row.confirmed_dates) as string[];
    const lastConfirmed = confirmed[confirmed.length - 1];
    if (lastConfirmed && lastConfirmed < today) {
      // 開催日が全部過ぎた卓は「これまでのセッション」
      past.push({
        id: row.id,
        title: row.title,
        role: row.role,
        confirmedDates: confirmed,
        archived: row.archived_at !== null,
      });
    } else if (row.archived_at === null) {
      active.push({
        id: row.id,
        title: row.title,
        role: row.role,
        confirmedDates: confirmed,
        firstCandidateDate: dates[0]!,
        lastCandidateDate: dates[dates.length - 1]!,
        // 並び順:次の開催日(なければ最初の候補日)が近い順
        sortKey: confirmed.find((d) => d >= today) ?? dates[0]!,
      });
    }
    // 記録になったが確定しなかった卓は、どちらにも出さない
  }
  active.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  // 新しい順(最後の開催日で比べる)
  past.sort((a, b) => b.confirmedDates.at(-1)!.localeCompare(a.confirmedDates.at(-1)!));

  const body: MySessionsResponse = {
    active: active.map(({ sortKey: _, ...rest }) => rest),
    past,
  };
  return c.json(body);
});
