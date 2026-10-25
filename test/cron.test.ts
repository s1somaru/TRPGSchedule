// 毎日の定期処理のテスト(spec.md 9.3)
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runDailyCleanup } from "../src/server/cron";
import worker from "../src/server/index";
import { addDays, jstNow } from "../src/shared/dates";
import { newParticipationId, newSessionId } from "../src/shared/ids";
import type { SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

// 定期処理を動かす日時(日本時間 2027-03-01 03:00)
const NOW = new Date("2027-02-28T18:00:00Z");
const today = jstNow(NOW).today; // 2027-03-01

async function seedSession(opts: {
  lastDate: string;
  confirmed?: boolean;
  members: { calendarId: string; role: "GM" | "PL"; override?: string }[];
}): Promise<string> {
  const id = newSessionId();
  const t = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sessions (id, title, candidate_dates, confirmed_date, last_date, archived_at, created_at, updated_at)
       VALUES (?1, 'テスト卓', ?2, ?3, ?4, NULL, ?5, ?5)`,
    ).bind(id, JSON.stringify([opts.lastDate]), opts.confirmed ? opts.lastDate : null, opts.lastDate, t),
    ...opts.members.map((m, i) =>
      env.DB.prepare(
        `INSERT INTO participations (id, session_id, calendar_id, role, display_name_override, joined_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(newParticipationId(), id, m.calendarId, m.role, m.override ?? null, new Date(Date.now() + i).toISOString()),
    ),
  ]);
  return id;
}

async function setLastAccessed(calendarId: string, iso: string) {
  await env.DB.prepare("UPDATE calendars SET last_accessed_at = ?1 WHERE id = ?2").bind(iso, calendarId).run();
}

async function archivedAt(sessionId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT archived_at FROM sessions WHERE id = ?1").bind(sessionId).first<{ archived_at: string | null }>();
  return row!.archived_at;
}

describe("記録への切り替え", () => {
  it("最後の日から90日を過ぎた卓だけを記録にし、名前を書き写す", async () => {
    const gm = await createCalendar("GM");
    const pl = await createCalendar("PL");
    const old = await seedSession({
      lastDate: addDays(today, -91),
      confirmed: true,
      members: [{ calendarId: gm.id, role: "GM" }, { calendarId: pl.id, role: "PL", override: "PC名" }],
    });
    const edge = await seedSession({ lastDate: addDays(today, -90), members: [{ calendarId: gm.id, role: "GM" }] });
    const recent = await seedSession({ lastDate: addDays(today, 10), members: [{ calendarId: gm.id, role: "GM" }] });

    const result = await runDailyCleanup(env.DB, NOW);
    expect(result.archivedSessions).toBeGreaterThanOrEqual(1);
    expect(await archivedAt(old)).toBe(NOW.toISOString());
    expect(await archivedAt(edge)).toBeNull();
    expect(await archivedAt(recent)).toBeNull();

    const { results } = await env.DB.prepare(
      "SELECT display_name_snapshot FROM participations WHERE session_id = ?1 ORDER BY joined_at",
    ).bind(old).all<{ display_name_snapshot: string }>();
    expect(results.map((r) => r.display_name_snapshot)).toEqual(["GM", "PC名"]);
  });

  it("記録になったあと名前を変えても、記録の名前は変わらない", async () => {
    const pl = await createCalendar("前の名前");
    const gm = await createCalendar("GM");
    const id = await seedSession({
      lastDate: addDays(today, -100),
      members: [{ calendarId: gm.id, role: "GM" }, { calendarId: pl.id, role: "PL" }],
    });
    await runDailyCleanup(env.DB, NOW);
    await api("PATCH", `/api/calendars/${pl.id}`, { secret: pl.editSecret, body: { displayName: "新しい名前" } });
    const s = await (await api("GET", `/api/sessions/${id}`)).json<SessionResponse>();
    expect(s.archived).toBe(true);
    expect(s.participants.map((p) => p.displayName)).toContain("前の名前");
  });

  it("件数が多くても、少しずつくり返して全部処理する(もう一度動かしても何も変わらない)", async () => {
    const gm = await createCalendar();
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await seedSession({ lastDate: addDays(today, -200 - i), members: [{ calendarId: gm.id, role: "GM" }] }));
    }
    await runDailyCleanup(env.DB, NOW, { batchSize: 2, maxRounds: 10 });
    for (const id of ids) expect(await archivedAt(id)).not.toBeNull();
    const again = await runDailyCleanup(env.DB, NOW, { batchSize: 2 });
    expect(again.archivedSessions).toBe(0);
  });

  it("1日にくり返す回数の上限で止まる(残りは次の日)", async () => {
    const gm = await createCalendar();
    for (let i = 0; i < 5; i++) {
      await seedSession({ lastDate: addDays(today, -300 - i), members: [{ calendarId: gm.id, role: "GM" }] });
    }
    // ほかのテストで作った卓も残っているので、件数ではなく「上限どおりか」を見る
    const r = await runDailyCleanup(env.DB, NOW, { batchSize: 2, maxRounds: 1 });
    expect(r.archivedSessions).toBeLessThanOrEqual(2);
  });
});

describe("古いカレンダーの削除", () => {
  it("1年使われていないカレンダーだけを削除し、卓には名前を残す", async () => {
    const oldCal = await createCalendar("昔の人");
    const activeCal = await createCalendar("今の人");
    await setLastAccessed(oldCal.id, new Date(NOW.getTime() - 366 * 864e5).toISOString());
    await setLastAccessed(activeCal.id, new Date(NOW.getTime() - 300 * 864e5).toISOString());
    const s = await seedSession({
      lastDate: addDays(today, 30),
      members: [{ calendarId: activeCal.id, role: "GM" }, { calendarId: oldCal.id, role: "PL" }],
    });

    const r = await runDailyCleanup(env.DB, NOW);
    expect(r.deletedCalendars).toBeGreaterThanOrEqual(1);
    const left = await env.DB.prepare("SELECT id FROM calendars WHERE id IN (?1, ?2)").bind(oldCal.id, activeCal.id).all<{ id: string }>();
    expect(left.results.map((x) => x.id)).toEqual([activeCal.id]);

    const view = await (await api("GET", `/api/sessions/${s}`)).json<SessionResponse>();
    expect(view.participants.find((p) => p.calendarDeleted)).toMatchObject({ displayName: "昔の人", calendarDeleted: true });
  });

  it("記録の卓に書き写してある名前(卓ごとの名前)は、削除しても上書きしない", async () => {
    const cal = await createCalendar("本名");
    const gm = await createCalendar("GM");
    const s = await seedSession({
      lastDate: addDays(today, -100),
      members: [{ calendarId: gm.id, role: "GM" }, { calendarId: cal.id, role: "PL", override: "探索者ジョン" }],
    });
    await runDailyCleanup(env.DB, NOW); // 記録になる
    await setLastAccessed(cal.id, new Date(NOW.getTime() - 400 * 864e5).toISOString());
    await runDailyCleanup(env.DB, NOW); // カレンダーが消える
    const view = await (await api("GET", `/api/sessions/${s}`)).json<SessionResponse>();
    expect(view.participants.map((p) => p.displayName)).toContain("探索者ジョン");
  });

  it("API でカレンダーを削除したときも、記録の卓の名前は上書きしない", async () => {
    const cal = await createCalendar("本名");
    const gm = await createCalendar("GM");
    const s = await seedSession({
      lastDate: addDays(today, -100),
      members: [{ calendarId: gm.id, role: "GM" }, { calendarId: cal.id, role: "PL", override: "PC名" }],
    });
    await runDailyCleanup(env.DB, NOW);
    expect((await api("DELETE", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(204);
    const view = await (await api("GET", `/api/sessions/${s}`)).json<SessionResponse>();
    expect(view.participants.map((p) => p.displayName)).toContain("PC名");
  });

});

describe("Worker の定期処理の入口", () => {
  it("scheduled から呼ばれ、記録への切り替えが動く", async () => {
    const gm = await createCalendar();
    const id = await seedSession({ lastDate: addDays(today, -120), members: [{ calendarId: gm.id, role: "GM" }] });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "0 18 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await archivedAt(id)).toBe(NOW.toISOString());
  });
});
