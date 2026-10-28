// 問い合わせ・評価のテスト(spec.md 3.17)
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { runDailyCleanup } from "../src/server/cron";
import { contactNoticeMail, notifyContact } from "../src/server/notify";
import { api } from "./helpers";

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
});

describe("古い問い合わせの返信先の削除", () => {
  it("1年たったものは返信先だけが消え、内容と評価は残る", async () => {
    const now = new Date("2027-12-01T00:00:00Z");
    const old = new Date(now.getTime() - 366 * 864e5).toISOString();
    const recent = new Date(now.getTime() - 10 * 864e5).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO feedback (id, kind, category, message, contact, created_at) VALUES ('fdb_old', 'contact', 'bug', '古い問い合わせ', 'old@example.com', ?1)",
      ).bind(old),
      env.DB.prepare(
        "INSERT INTO feedback (id, kind, category, message, contact, created_at) VALUES ('fdb_new', 'contact', 'bug', '新しい問い合わせ', 'new@example.com', ?1)",
      ).bind(recent),
      env.DB.prepare("INSERT INTO feedback (id, kind, rating, message, created_at) VALUES ('fdb_rate', 'rating', 4, 'よい', ?1)").bind(old),
    ]);
    const r = await runDailyCleanup(env.DB, now);
    expect(r.anonymizedFeedback).toBeGreaterThanOrEqual(1);
    const { results } = await env.DB.prepare(
      "SELECT id, message, contact, rating FROM feedback WHERE id IN ('fdb_old', 'fdb_new', 'fdb_rate') ORDER BY id",
    ).all();
    expect(results).toEqual([
      { id: "fdb_new", message: "新しい問い合わせ", contact: "new@example.com", rating: null },
      { id: "fdb_old", message: "古い問い合わせ", contact: null, rating: null },
      { id: "fdb_rate", message: "よい", contact: null, rating: 4 },
    ]);
  });
});

describe("お問い合わせの通知メール", () => {
  /** Resend に送られたメール(test/setup.ts で横取りしたもの) */
  function sentMails(): { url: string; auth: string | null; body: Record<string, unknown> }[] {
    return vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/"))
      .map(([input, init]) => ({
        url: String(input),
        auth: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }));
  }

  it("お問い合わせが届くと、運営者に1通送る。内容と返信先は入れない", async () => {
    const res = await api("POST", "/api/feedback", {
      body: { kind: "contact", category: "bug", message: "秘密の相談です", contact: "taro@example.com", page: "/s" },
    });
    expect(res.status).toBe(201);
    const mails = sentMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.auth).toBe("Bearer re_test_key");
    expect(mails[0]!.body).toMatchObject({ from: "たくよせ <onboarding@resend.dev>", to: ["owner@example.com"] });
    expect(mails[0]!.body.subject).toBe("[たくよせ] お問い合わせが届きました(不具合の報告)");
    const whole = JSON.stringify(mails[0]!.body);
    expect(whole).not.toContain("秘密の相談");
    expect(whole).not.toContain("taro@example.com");
    expect(mails[0]!.body.text).toContain("送ったページ:/s");
  });

  it("★の評価では送らない", async () => {
    expect((await api("POST", "/api/feedback", { body: { kind: "rating", rating: 5, message: "よい" } })).status).toBe(201);
    expect(sentMails()).toHaveLength(0);
  });

  it("入力が正しくなくて保存しなかったときは送らない", async () => {
    expect((await api("POST", "/api/feedback", { body: { kind: "contact", category: "bug", message: " " } })).status).toBe(422);
    expect(sentMails()).toHaveLength(0);
  });

  it("送るのに失敗しても、問い合わせは受け付ける", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("bad", { status: 500 }));
    const res = await api("POST", "/api/feedback", { body: { kind: "contact", category: "other", message: "x" } });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(JSON.stringify({ code: "NOTIFY_FAILED", status: 500 })));
  });

  it("キーか宛先が設定されていなければ、何もしない(手元の開発環境)", async () => {
    await notifyContact({ ...env, RESEND_API_KEY: undefined }, { category: "bug", page: null, createdAt: new Date() });
    await notifyContact({ ...env, NOTIFY_EMAIL: "" }, { category: "bug", page: null, createdAt: new Date() });
    expect(sentMails()).toHaveLength(0);
  });

  it("日時は日本時間で書く", () => {
    const mail = contactNoticeMail({ category: "question", page: null, createdAt: new Date("2026-10-29T15:30:00Z") });
    expect(mail.subject).toBe("[たくよせ] お問い合わせが届きました(使い方の質問)");
    expect(mail.text).toContain("2026/10/30 0:30");
    expect(mail.text).toContain("送ったページ:(不明)");
  });
});
