// 個人カレンダー API の追加テスト(最後に使った日時・再発行の境目・401・一度に送れる日数)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { acceptedRange, addDays, jstNow } from "../src/shared/dates";
import { newSecret } from "../src/shared/ids";
import type { CalendarResponse, SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);
const OLD = () => new Date(Date.now() - 400 * 864e5).toISOString();

async function setLastAccessed(id: string, iso: string) {
  await env.DB.prepare("UPDATE calendars SET last_accessed_at = ?1 WHERE id = ?2").bind(iso, id).run();
}

async function lastAccessed(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT last_accessed_at FROM calendars WHERE id = ?1").bind(id).first<{ last_accessed_at: string }>();
  return row!.last_accessed_at;
}

/**
 * 最後に使った日時が今日になるのを待つ。
 * 記録は応答のあとに(waitUntil で)書かれるので、少しのあいだ確かめ直す
 */
async function waitUntilTouched(id: string): Promise<string> {
  let value = await lastAccessed(id);
  for (let i = 0; i < 50 && jstNow(new Date(value)).today !== jstNow().today; i++) {
    await new Promise((r) => setTimeout(r, 20));
    value = await lastAccessed(id);
  }
  return value;
}

function expectToday(iso: string) {
  expect(jstNow(new Date(iso)).today).toBe(jstNow().today);
  expect(Date.now() - new Date(iso).getTime()).toBeLessThan(60_000);
}

describe("最後に使った日時(1年使われていないカレンダーの削除に使う)", () => {
  it("自分のカレンダーを開くと、今日の日時になる", async () => {
    const cal = await createCalendar();
    await setLastAccessed(cal.id, OLD());
    expect((await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(200);
    expectToday(await waitUntilTouched(cal.id));
  });

  it("参加している卓を秘密つきで開いても、今日の日時になる", async () => {
    const cal = await createCalendar("GM");
    const created = await api("POST", "/api/sessions", { secret: cal.editSecret, body: { title: "卓", candidateDates: [day(3)] } });
    const s = await created.json<SessionResponse>();
    await setLastAccessed(cal.id, OLD());
    expect((await api("GET", `/api/sessions/${s.id}`, { secret: cal.editSecret })).status).toBe(200);
    expectToday(await waitUntilTouched(cal.id));
  });

  it("参加中の卓の一覧を開いても、今日の日時になる", async () => {
    const cal = await createCalendar();
    await setLastAccessed(cal.id, OLD());
    expect((await api("GET", `/api/calendars/${cal.id}/sessions`, { secret: cal.editSecret })).status).toBe(200);
    expectToday(await waitUntilTouched(cal.id));
  });

  it("秘密がないときや他人の秘密のときは、変わらない", async () => {
    const cal = await createCalendar();
    const other = await createCalendar();
    const old = OLD();
    await setLastAccessed(cal.id, old);
    await api("GET", `/api/calendars/${cal.id}`);
    await api("GET", `/api/calendars/${cal.id}`, { secret: other.editSecret });
    await new Promise((r) => setTimeout(r, 100));
    expect(await lastAccessed(cal.id)).toBe(old);
  });
});

describe("予定の更新(空の送信)", () => {
  it("{ availability: {} } は 200 で今のカレンダーを返す。他人の秘密なら 401", async () => {
    const cal = await createCalendar("たろう");
    await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability: { [day(2)]: { s: "o" } } } });
    const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability: {} } });
    expect(res.status).toBe(200);
    const body = await res.json<CalendarResponse>();
    expect(body).toMatchObject({ id: cal.id, displayName: "たろう", availability: { [day(2)]: { s: "o" } } });

    const other = await createCalendar();
    expect((await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: other.editSecret, body: { availability: {} } })).status).toBe(401);
    expect((await api("PUT", `/api/calendars/${cal.id}/availability`, { body: { availability: {} } })).status).toBe(401);
  });
});

describe("一度に送れる日数", () => {
  it("201日分は、範囲に関係なく 422(日数の上限)", async () => {
    const cal = await createCalendar();
    const availability = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [day(i), { s: "o" }]));
    const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
    expect(res.status).toBe(422);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("VALIDATION_FAILED");
  });

  it("200日分は日数の上限には引っかからない(範囲外の日があるので DATE_OUT_OF_RANGE になる)", async () => {
    // 入力できる期間は今日から6か月(約184日)なので、範囲内の日だけで200日分は作れない
    const cal = await createCalendar();
    const availability = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [day(i), { s: "o" }]));
    const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
    expect(res.status).toBe(422);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("DATE_OUT_OF_RANGE");
  });

  it("入力できる期間の全部の日を一度に保存できる", async () => {
    const cal = await createCalendar();
    const { to } = acceptedRange();
    const availability: Record<string, { s: string }> = {};
    for (let d = jstNow().today; d <= to; d = addDays(d, 1)) availability[d] = { s: "t" };
    const n = Object.keys(availability).length;
    expect(n).toBeGreaterThan(180);
    const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json<CalendarResponse>()).availability)).toHaveLength(n);
  });
});

describe("編集URLの再発行(境目)", () => {
  const reissue = (id: string, secret: string | undefined, next: string) =>
    api("POST", `/api/calendars/${id}/edit-secret`, { secret, body: { newSecret: next } });

  it("新しい秘密が今と同じなら 422", async () => {
    const cal = await createCalendar();
    expect((await reissue(cal.id, cal.editSecret, cal.editSecret)).status).toBe(422);
  });

  it("Authorization がないと 401", async () => {
    const cal = await createCalendar();
    expect((await reissue(cal.id, undefined, newSecret())).status).toBe(401);
  });

  it("B の秘密で A の再発行はできず、A の古い秘密はそのまま使える", async () => {
    const a = await createCalendar("A");
    const b = await createCalendar("B");
    expect((await reissue(a.id, b.editSecret, newSecret())).status).toBe(401);
    expect((await api("GET", `/api/calendars/${a.id}`, { secret: a.editSecret })).status).toBe(200);
    expect((await api("GET", `/api/calendars/${b.id}`, { secret: b.editSecret })).status).toBe(200);
  });
});

describe("本人だけの操作の 401", () => {
  it("参加中の卓の一覧とカレンダーの削除は、秘密なし・他人の秘密で 401", async () => {
    const a = await createCalendar("A");
    const b = await createCalendar("B");
    for (const secret of [undefined, b.editSecret]) {
      expect((await api("GET", `/api/calendars/${a.id}/sessions`, { secret })).status).toBe(401);
      expect((await api("DELETE", `/api/calendars/${a.id}`, { secret })).status).toBe(401);
    }
    // 消えていない
    expect((await api("GET", `/api/calendars/${a.id}`, { secret: a.editSecret })).status).toBe(200);
  });
});
