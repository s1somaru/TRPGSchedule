// 外部レビュー(2026-10-26)で見つかった点の直しを確かめる
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { redact } from "../src/server/errors";
import { addDays, jstNow } from "../src/shared/dates";
import { newSecret } from "../src/shared/ids";
import type { SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);
const OLD = () => new Date(Date.now() - 400 * 864e5).toISOString();

async function setLastAccessed(id: string, iso: string) {
  await env.DB.prepare("UPDATE calendars SET last_accessed_at = ?1 WHERE id = ?2").bind(iso, id).run();
}

/** 記録は応答のあとに書かれることがあるので、今日になるまで少し待つ */
async function waitTouched(id: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const row = await env.DB.prepare("SELECT last_accessed_at FROM calendars WHERE id = ?1").bind(id).first<{ last_accessed_at: string }>();
    if (jstNow(new Date(row!.last_accessed_at)).today === jstNow().today) return row!.last_accessed_at;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("最後に使った日時が更新されませんでした");
}

describe("伏せ字", () => {
  it("前に記号や英字が付いていても、IDと秘密を伏せる", () => {
    const secret = newSecret();
    expect(redact(`x_${secret}`)).not.toContain(secret.slice(4));
    expect(redact(`A${secret}`)).not.toContain(secret.slice(4));
    expect(redact(`URL:https://example.com/c/cal_abcdefghijklmnopqrstuv#${secret}`)).toBe(
      "URL:https://example.com/c/cal_***#sec_***",
    );
  });

  it("お問い合わせに書かれた編集URLは、伏せてから保存する", async () => {
    const secret = newSecret();
    const res = await api("POST", "/api/feedback", {
      body: { kind: "contact", category: "bug", message: `開けません https://x/c/cal_abcdefghijklmnopqrstuv#${secret}`, contact: `${secret}` },
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT message, contact FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT 1").first<{
      message: string;
      contact: string;
    }>();
    expect(row!.message).not.toContain(secret.slice(4));
    expect(row!.message).toContain("sec_***");
    expect(row!.contact).toBe("sec_***");
  });
});

describe("別のサイトからの書き込み", () => {
  it("Sec-Fetch-Site が cross-site / same-site なら 403。same-origin と、付いていないときは通す", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const res = await api("POST", "/api/calendars", { body: { displayName: "x" }, headers: { "Sec-Fetch-Site": site } });
      expect(res.status, site).toBe(403);
    }
    for (const headers of [{ "Sec-Fetch-Site": "same-origin" }, {}]) {
      const res = await api("POST", "/api/calendars", { body: { displayName: "x" }, headers });
      expect(res.status).toBe(201);
    }
  });

  it("読むだけのリクエストは、Sec-Fetch-Site に関係なく通す", async () => {
    const cal = await createCalendar();
    const res = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret, headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(200);
  });
});

describe("最後に使った日時", () => {
  it("空の保存でも更新する", async () => {
    const cal = await createCalendar();
    await setLastAccessed(cal.id, OLD());
    const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability: {} } });
    expect(res.status).toBe(200);
    await waitTouched(cal.id);
  });

  it("編集URLを作り直したときも更新する", async () => {
    const cal = await createCalendar();
    await setLastAccessed(cal.id, OLD());
    const res = await api("POST", `/api/calendars/${cal.id}/edit-secret`, { secret: cal.editSecret, body: { newSecret: newSecret() } });
    expect(res.status).toBe(200);
    await waitTouched(cal.id);
  });
});

describe("中身が空の変更", () => {
  it("卓と参加者の PATCH に {} を送ると 422", async () => {
    const gm = await createCalendar("GM");
    const created = await api("POST", "/api/sessions", { secret: gm.editSecret, body: { title: "卓", candidateDates: [day(3)] } });
    const s = (await created.json()) as SessionResponse;
    const me = s.participants[0]!;

    expect((await api("PATCH", `/api/sessions/${s.id}`, { secret: gm.editSecret, body: {} })).status).toBe(422);
    expect((await api("PATCH", `/api/sessions/${s.id}/participants/${me.id}`, { secret: gm.editSecret, body: {} })).status).toBe(422);
    // 時間帯を外す(null)は、変える内容として受け付ける
    expect((await api("PATCH", `/api/sessions/${s.id}`, { secret: gm.editSecret, body: { timeWindow: null } })).status).toBe(200);
  });
});
