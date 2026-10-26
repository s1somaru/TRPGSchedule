// 問い合わせ・評価の受け付け(spec.md 3.17)。ログインなしで誰でも送れる
import { Hono } from "hono";
import { newFeedbackId } from "../../shared/ids";
import { FeedbackBody } from "../../shared/schema";
import { readBody, redact } from "../errors";
import { rateLimit } from "../ratelimit";
import type { AppEnv } from "../types";

export const feedback = new Hono<AppEnv>();

// 送る(作りすぎ対策と同じ回数制限をかける)
feedback.post("/", rateLimit("RL_CREATE"), async (c) => {
  const body = await readBody(c, FeedbackBody);
  const isContact = body.kind === "contact";
  await c.env.DB.prepare(
    `INSERT INTO feedback (id, kind, rating, category, message, contact, page, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      newFeedbackId(),
      body.kind,
      isContact ? null : body.rating,
      isContact ? body.category : null,
      // 誤って書かれた編集URLなどは、保存する前に伏せ字にする
      redact(body.message ?? ""),
      isContact && body.contact ? redact(body.contact) : null,
      body.page ?? null,
      new Date().toISOString(),
    )
    .run();
  return c.json({ ok: true }, 201);
});
