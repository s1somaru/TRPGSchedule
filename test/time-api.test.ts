// 時刻・時間帯まわりの API のテスト(spec.md 3.18)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import type { CalendarCreatedResponse, CalendarResponse, SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

function putAvailability(cal: CalendarCreatedResponse, availability: unknown) {
  return api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
}

async function getCalendar(cal: CalendarCreatedResponse): Promise<CalendarResponse> {
  const res = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret });
  if (res.status !== 200) throw new Error(`取得に失敗: ${res.status}`);
  return res.json();
}

function patchCalendar(cal: CalendarCreatedResponse, body: unknown) {
  return api("PATCH", `/api/calendars/${cal.id}`, { secret: cal.editSecret, body });
}

async function createSession(gm: CalendarCreatedResponse, body: Record<string, unknown>): Promise<SessionResponse> {
  const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body });
  if (res.status !== 201) throw new Error(`卓の作成に失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getSession(id: string, secret?: string): Promise<SessionResponse> {
  const res = await api("GET", `/api/sessions/${id}`, { secret });
  if (res.status !== 200) throw new Error(`取得に失敗: ${res.status}`);
  return res.json();
}

function patchSession(id: string, cal: CalendarCreatedResponse, body: unknown) {
  return api("PATCH", `/api/sessions/${id}`, { secret: cal.editSecret, body });
}

describe("予定の時刻", () => {
  it("時刻を付けて保存すると、そのまま返る", async () => {
    const cal = await createCalendar();
    const res = await putAvailability(cal, {
      [day(1)]: { s: "o", time: { from: "21:00", to: "25:00" } },
      [day(2)]: { s: "t", time: { from: "20:30" } },
    });
    expect(res.status).toBe(200);
    expect((await getCalendar(cal)).availability).toEqual({
      [day(1)]: { s: "o", time: { from: "21:00", to: "25:00" } },
      [day(2)]: { s: "t", time: { from: "20:30" } },
    });
  });

  it("使えない時刻は 422", async () => {
    const cal = await createCalendar();
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: { from: "21:15" } } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: { from: "22:00", to: "21:00" } } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: { from: "22:00", to: "22:00" } } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: { from: "30:00" } } })).status).toBe(422);
    // 余計な項目は形の違いなので 400
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: { from: "21:00", extra: 1 } } })).status).toBe(400);
    expect((await getCalendar(cal)).availability).toEqual({});
  });

  it("× の日に付けた時刻は捨てる", async () => {
    const cal = await createCalendar();
    expect((await putAvailability(cal, { [day(1)]: { s: "x", time: { from: "21:00" } } })).status).toBe(200);
    expect((await getCalendar(cal)).availability[day(1)]).toEqual({ s: "x" });
  });

  it("卓には候補日の分だけ時刻が見え、いつもの時間は見えない", async () => {
    const gm = await createCalendar("GM");
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3)] });
    await putAvailability(gm, {
      [day(3)]: { s: "o", time: { from: "21:00" } },
      [day(4)]: { s: "o", time: { from: "20:00" } },
    });
    expect((await patchCalendar(gm, { weeklyTimes: { "6": { from: "13:00" } } })).status).toBe(200);

    const res = await api("GET", `/api/sessions/${s.id}`);
    const text = await res.text();
    expect(text).not.toContain("weeklyTimes");
    expect(text).not.toContain("13:00");
    const body = JSON.parse(text) as SessionResponse;
    expect(body.participants[0]!.availability).toEqual({ [day(3)]: { s: "o", time: { from: "21:00" } } });

    // 本人が見ても同じ
    const mine = await api("GET", `/api/sessions/${s.id}`, { secret: gm.editSecret });
    expect(await mine.text()).not.toContain("weeklyTimes");
  });
});

describe("曜日ごとの「いつもの時間」", () => {
  it("新しいカレンダーは空", async () => {
    const cal = await createCalendar();
    expect((await getCalendar(cal)).weeklyTimes).toEqual({});
  });

  it("保存したものが返り、まるごと置き換わる", async () => {
    const cal = await createCalendar();
    const weekly = { "0": { from: "13:00", to: "18:00" }, "5": { from: "21:00" } };
    const res = await patchCalendar(cal, { weeklyTimes: weekly });
    expect(res.status).toBe(200);
    expect((await res.json<CalendarResponse>()).weeklyTimes).toEqual(weekly);
    expect((await getCalendar(cal)).weeklyTimes).toEqual(weekly);

    await patchCalendar(cal, { weeklyTimes: { "3": { from: "20:00" } } });
    expect((await getCalendar(cal)).weeklyTimes).toEqual({ "3": { from: "20:00" } });

    await patchCalendar(cal, { weeklyTimes: {} });
    expect((await getCalendar(cal)).weeklyTimes).toEqual({});
  });

  it("曜日の指定が違えば 400(形の違い)、時刻が正しくなければ 422", async () => {
    const cal = await createCalendar();
    expect((await patchCalendar(cal, { weeklyTimes: { "7": { from: "21:00" } } })).status).toBe(400);
    expect((await patchCalendar(cal, { weeklyTimes: { mon: { from: "21:00" } } })).status).toBe(400);
    expect((await patchCalendar(cal, { weeklyTimes: { "1": { from: "21:15" } } })).status).toBe(422);
    expect((await getCalendar(cal)).weeklyTimes).toEqual({});
  });

  it("変える内容がなければ 422", async () => {
    const cal = await createCalendar();
    expect((await patchCalendar(cal, {})).status).toBe(422);
  });

  it("いつもの時間を変えても「最終更新」は進まない。表示名を変えると進む", async () => {
    const cal = await createCalendar("まえ");
    const old = "2026-01-01T00:00:00.000Z";
    await env.DB.prepare("UPDATE calendars SET last_updated_at = ?1 WHERE id = ?2").bind(old, cal.id).run();

    const r1 = await patchCalendar(cal, { weeklyTimes: { "2": { from: "21:00" } } });
    expect((await r1.json<CalendarResponse>()).lastUpdatedAt).toBe(old);
    expect((await getCalendar(cal)).lastUpdatedAt).toBe(old);
    expect((await getCalendar(cal)).displayName).toBe("まえ");

    const r2 = await patchCalendar(cal, { displayName: "あと" });
    const after = await r2.json<CalendarResponse>();
    expect(after.lastUpdatedAt).not.toBe(old);
    expect(after.displayName).toBe("あと");
    // 表示名だけ変えたときは、いつもの時間はそのまま
    expect(after.weeklyTimes).toEqual({ "2": { from: "21:00" } });
  });

  it("表示名といつもの時間を同時に変えられる", async () => {
    const cal = await createCalendar("まえ");
    const res = await patchCalendar(cal, { displayName: "あと", weeklyTimes: { "4": { from: "19:00" } } });
    expect(res.status).toBe(200);
    expect(await res.json<CalendarResponse>()).toMatchObject({
      displayName: "あと",
      weeklyTimes: { "4": { from: "19:00" } },
    });
  });
});

describe("卓の時間帯", () => {
  it("作るときに時間帯を付けられる。付けなければ null", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm, {
      title: "卓",
      candidateDates: [day(3)],
      timeWindow: { from: "21:00", to: "24:00" },
    });
    expect(s.timeWindow).toEqual({ from: "21:00", to: "24:00" });
    expect(s.dateTimes).toEqual({});
    expect((await getSession(s.id)).timeWindow).toEqual({ from: "21:00", to: "24:00" });

    const plain = await createSession(gm, { title: "卓", candidateDates: [day(3)] });
    expect(plain.timeWindow).toBeNull();
    expect(plain.dateTimes).toEqual({});
  });

  it("作るときの時間帯が正しくなければ 422", async () => {
    const gm = await createCalendar();
    const res = await api("POST", "/api/sessions", {
      secret: gm.editSecret,
      body: { title: "卓", candidateDates: [day(3)], timeWindow: { from: "21:00", to: "20:00" } },
    });
    expect(res.status).toBe(422);
  });

  it("変更でき、null で外せる。ほかの変更では今のまま残る", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3)] });

    expect((await patchSession(s.id, gm, { timeWindow: { from: "20:00" } })).status).toBe(200);
    expect((await getSession(s.id)).timeWindow).toEqual({ from: "20:00" });

    expect((await patchSession(s.id, gm, { title: "新しい卓" })).status).toBe(200);
    expect((await getSession(s.id)).timeWindow).toEqual({ from: "20:00" });

    expect((await patchSession(s.id, gm, { timeWindow: null })).status).toBe(200);
    expect((await getSession(s.id)).timeWindow).toBeNull();
  });

  it("正しくない時間帯は 422", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3)] });
    expect((await patchSession(s.id, gm, { timeWindow: { from: "21:15" } })).status).toBe(422);
    expect((await patchSession(s.id, gm, { timeWindow: { from: "30:00" } })).status).toBe(422);
    expect((await patchSession(s.id, gm, { dateTimes: { [day(3)]: { from: "05:00" } } })).status).toBe(422);
    expect((await getSession(s.id)).timeWindow).toBeNull();
  });

  it("GM でなければ変えられない(403)", async () => {
    const gm = await createCalendar("GM");
    const pl = await createCalendar("PL");
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3)] });
    const joinRes = await api("POST", `/api/sessions/${s.id}/participants`, { secret: pl.editSecret, body: {} });
    expect(joinRes.status).toBe(201);
    expect((await patchSession(s.id, pl, { timeWindow: { from: "21:00" } })).status).toBe(403);
    expect((await patchSession(s.id, pl, { dateTimes: { [day(3)]: { from: "21:00" } } })).status).toBe(403);
    expect((await getSession(s.id)).timeWindow).toBeNull();
  });

  it("日ごとの時間帯は、候補日の分だけ残る", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3), day(5)] });
    const res = await patchSession(s.id, gm, {
      dateTimes: { [day(3)]: { from: "14:00", to: "18:00" }, [day(4)]: { from: "20:00" } },
    });
    expect(res.status).toBe(200);
    expect((await res.json<SessionResponse>()).dateTimes).toEqual({ [day(3)]: { from: "14:00", to: "18:00" } });
    expect((await getSession(s.id)).dateTimes).toEqual({ [day(3)]: { from: "14:00", to: "18:00" } });
  });

  it("候補日から外した日の、日ごとの時間帯は消える", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3), day(5)] });
    await patchSession(s.id, gm, { dateTimes: { [day(3)]: { from: "14:00" }, [day(5)]: { from: "20:00" } } });
    expect((await getSession(s.id)).dateTimes).toEqual({ [day(3)]: { from: "14:00" }, [day(5)]: { from: "20:00" } });

    expect((await patchSession(s.id, gm, { candidateDates: [day(5)] })).status).toBe(200);
    expect((await getSession(s.id)).dateTimes).toEqual({ [day(5)]: { from: "20:00" } });

    // 同じ日をもう一度候補日に戻しても、消えた時間帯は戻らない
    await patchSession(s.id, gm, { candidateDates: [day(3), day(5)] });
    expect((await getSession(s.id)).dateTimes).toEqual({ [day(5)]: { from: "20:00" } });
  });
});

describe("テーブルの列(migrations/0004)", () => {
  interface Col {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }
  async function columns(table: string): Promise<Record<string, Col>> {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<Col>();
    return Object.fromEntries(results.map((c) => [c.name, c]));
  }

  it("calendars に weekly_times がある(空のオブジェクトが既定)", async () => {
    const col = (await columns("calendars")).weekly_times;
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(col!.dflt_value).toBe("'{}'");
  });

  it("sessions に time_window(NULL 可)と date_times(空のオブジェクトが既定)がある", async () => {
    const cols = await columns("sessions");
    expect(cols.time_window).toBeDefined();
    expect(cols.time_window!.notnull).toBe(0);
    expect(cols.time_window!.dflt_value).toBeNull();
    expect(cols.date_times).toBeDefined();
    expect(cols.date_times!.notnull).toBe(1);
    expect(cols.date_times!.dflt_value).toBe("'{}'");
  });
});
