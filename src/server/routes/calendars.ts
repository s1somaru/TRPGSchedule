// 個人カレンダーの API(spec.md 5.5)
import { Hono } from "hono";
import { acceptedRange, jstNow } from "../../shared/dates";
import { ID_PATTERNS, newCalendarId, newSecret, newShareToken } from "../../shared/ids";
import {
  AvailabilityUpdate,
  CreateCalendar,
  CreateShareToken,
  PatchCalendar,
  ReissueSecret,
  ShareTokenTtl,
} from "../../shared/schema";
import type {
  CalendarCreatedResponse,
  MySessionsResponse,
  PastSessionSummary,
  MySessionSummary,
  ShareTokenResponse,
} from "../../shared/types";
import { readBearer, requireOwner, sha256Hex } from "../auth";
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

// 取得
calendars.get("/:id", async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
  return c.json((await db.getCalendar(c.env.DB, id))!);
});

// 表示名の変更
calendars.patch("/:id", rateLimit("RL_WRITE"), async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
  const { displayName } = await readBody(c, PatchCalendar);
  return c.json(await db.updateDisplayName(c.env.DB, id, displayName, new Date().toISOString()));
});

// 予定の更新
calendars.put("/:id/availability", rateLimit("RL_WRITE"), async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
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
    return c.json((await db.getCalendar(c.env.DB, id))!);
  }
  return c.json(await db.mergeAvailability(c.env.DB, id, availability, now));
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

// 共有トークンの発行
calendars.post("/:id/share-tokens", rateLimit("RL_TOKEN"), async (c) => {
  const cal = await requireOwner(c, c.req.param("id"));
  const { ttlSeconds = ShareTokenTtl.default } = await readBody(c, CreateShareToken);
  const shareToken = newShareToken();
  // 期限が来たら KV が自動で消す
  await c.env.SHARE_TOKENS.put(
    shareToken,
    JSON.stringify({ calendarId: cal.id, generation: cal.tokenGeneration }),
    { expirationTtl: ttlSeconds },
  );
  const body: ShareTokenResponse = {
    shareToken,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
  return c.json(body, 201);
});

// 参加中の卓と、これまでのセッション
calendars.get("/:id/sessions", async (c) => {
  const { id } = await requireOwner(c, c.req.param("id"));
  const rows = await db.listMySessions(c.env.DB, id);
  const { today } = jstNow();

  const active: (MySessionSummary & { sortKey: string })[] = [];
  const past: PastSessionSummary[] = [];
  for (const row of rows) {
    const dates = JSON.parse(row.candidate_dates) as string[];
    if (row.confirmed_date && row.confirmed_date < today) {
      past.push({
        id: row.id,
        title: row.title,
        role: row.role,
        confirmedDate: row.confirmed_date,
        archived: row.archived_at !== null,
      });
    } else if (row.archived_at === null) {
      active.push({
        id: row.id,
        title: row.title,
        role: row.role,
        confirmedDate: row.confirmed_date,
        firstCandidateDate: dates[0]!,
        lastCandidateDate: dates[dates.length - 1]!,
        sortKey: row.confirmed_date ?? dates[0]!,
      });
    }
    // 記録になったが確定しなかった卓は、どちらにも出さない
  }
  active.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  past.sort((a, b) => b.confirmedDate.localeCompare(a.confirmedDate));

  const body: MySessionsResponse = {
    active: active.map(({ sortKey: _, ...rest }) => rest),
    past,
  };
  return c.json(body);
});
