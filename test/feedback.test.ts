// 問い合わせ・評価のテスト(spec.md 3.17)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runDailyCleanup } from "../src/server/cron";
import { api, freshIp } from "./helpers";

interface FeedbackRow {
  kind: string;
  rating: number | null;
  category: string | null;
  message: string;
  contact: string | null;
  page: string | null;
}

async function latest(): Promise<FeedbackRow> {
  return (await env.DB.prepare(
    "SELECT kind, rating, category, message, contact, page FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).first<FeedbackRow>())!;
}

describe("評価", () => {
  it("★とひとことを送ると保存される(ひとことは省略できる)", async () => {
    let res = await api("POST", "/api/feedback", { body: { kind: "rating", rating: 4, message: "使いやすい", page: "/s" } });
    expect(res.status).toBe(201);
    expect(await latest()).toEqual({ kind: "rating", rating: 4, category: null, message: "使いやすい", contact: null, page: "/s" });

    res = await api("POST", "/api/feedback", { body: { kind: "rating", rating: 5 } });
    expect(res.status).toBe(201);
    expect(await latest()).toMatchObject({ rating: 5, message: "" });
  });

  it("★は1〜5の整数だけ", async () => {
    for (const rating of [0, 6, 3.5]) {
      const res = await api("POST", "/api/feedback", { body: { kind: "rating", rating } });
      expect(res.status).toBe(422);
    }
    expect((await api("POST", "/api/feedback", { body: { kind: "rating", rating: "5" } })).status).toBe(400);
  });

  it("ひとことは500文字まで", async () => {
    const res = await api("POST", "/api/feedback", { body: { kind: "rating", rating: 3, message: "あ".repeat(501) } });
    expect(res.status).toBe(422);
  });
});

describe("問い合わせ", () => {
  it("種類・内容・返信先を送ると保存される", async () => {
    const res = await api("POST", "/api/feedback", {
      body: { kind: "contact", category: "bug", message: "表が崩れます\n手順:…", contact: "discord: taro", page: "/c" },
    });
    expect(res.status).toBe(201);
    expect(await latest()).toEqual({
      kind: "contact",
      rating: null,
      category: "bug",
      message: "表が崩れます\n手順:…",
      contact: "discord: taro",
      page: "/c",
    });
  });

  it("内容が空・種類が違う・長すぎると断る", async () => {
    const send = (body: unknown) => api("POST", "/api/feedback", { body });
    expect((await send({ kind: "contact", category: "bug", message: "  " })).status).toBe(422);
    // 決まった値以外の種類は「形が違う」(400)。ほかの API の役割(GM/PL)と同じ扱い
    expect((await send({ kind: "contact", category: "spam", message: "x" })).status).toBe(400);
    expect((await send({ kind: "contact", category: "other", message: "あ".repeat(2001) })).status).toBe(422);
    expect((await send({ kind: "contact", category: "other", message: "x", contact: "a".repeat(101) })).status).toBe(422);
  });

  it("どの画面から送ったかは、決まった種類だけ(ID などは入れられない)", async () => {
    const res = await api("POST", "/api/feedback", {
      body: { kind: "contact", category: "other", message: "x", page: "/c/cal_AAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(res.status).toBe(400);
  });

  it("知らない種類・知らない項目は断る", async () => {
    expect((await api("POST", "/api/feedback", { body: { kind: "spam", message: "x" } })).status).toBe(400);
    expect((await api("POST", "/api/feedback", { body: { kind: "rating", rating: 5, admin: true } })).status).toBe(400);
  });

  it("同じ接続元から送りすぎると 429", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await api("POST", "/api/feedback", { body: { kind: "rating", rating: 5 }, ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("古い問い合わせ・評価の削除", () => {
  it("1年たったものは毎日の定期処理で消える", async () => {
    const now = new Date("2027-12-01T00:00:00Z");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO feedback (id, kind, rating, message, created_at) VALUES ('fdb_old', 'rating', 5, '', ?1)").bind(
        new Date(now.getTime() - 366 * 864e5).toISOString(),
      ),
      env.DB.prepare("INSERT INTO feedback (id, kind, rating, message, created_at) VALUES ('fdb_new', 'rating', 5, '', ?1)").bind(
        new Date(now.getTime() - 10 * 864e5).toISOString(),
      ),
    ]);
    const r = await runDailyCleanup(env.DB, now);
    expect(r.deletedFeedback).toBeGreaterThanOrEqual(1);
    const left = await env.DB.prepare("SELECT id FROM feedback WHERE id IN ('fdb_old', 'fdb_new')").all<{ id: string }>();
    expect(left.results.map((x) => x.id)).toEqual(["fdb_new"]);
  });
});
