// 卓のGMの決まり・同時操作・記録の卓の追加テスト(spec.md 5.6 / 7.1)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import { newParticipationId, newSessionId } from "../src/shared/ids";
import type { CalendarCreatedResponse, SessionResponse } from "../src/shared/types";
import { deleteParticipant, insertParticipant, updateSession } from "../src/server/db-sessions";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

async function createSession(gm: CalendarCreatedResponse, title = "テスト卓"): Promise<SessionResponse> {
  const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body: { title, candidateDates: [day(3), day(5)] } });
  if (res.status !== 201) throw new Error(`卓の作成に失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function joined(sessionId: string, cal: CalendarCreatedResponse): Promise<string> {
  const res = await api("POST", `/api/sessions/${sessionId}/participants`, { secret: cal.editSecret, body: {} });
  if (res.status !== 201) throw new Error(`参加に失敗: ${res.status} ${await res.text()}`);
  return (await res.json<{ id: string }>()).id;
}

async function getSession(id: string): Promise<SessionResponse> {
  return (await api("GET", `/api/sessions/${id}`)).json();
}

async function code(res: Response): Promise<string> {
  return (await res.json<{ error: { code: string } }>()).error.code;
}

const patchPart = (sid: string, pid: string, secret: string, body: unknown) =>
  api("PATCH", `/api/sessions/${sid}/participants/${pid}`, { secret, body });
const deletePart = (sid: string, pid: string, secret: string) =>
  api("DELETE", `/api/sessions/${sid}/participants/${pid}`, { secret });

describe("断られたカレンダーの削除のあとで名前を変える", () => {
  it("唯一のGMで削除が断られ、名前を変えてから共同GMを立てて削除すると、卓には新しい名前が残る", async () => {
    const a = await createCalendar("古い名前");
    const b = await createCalendar("B");
    const s = await createSession(a);

    // 唯一のGMなので断られる
    const refused = await api("DELETE", `/api/calendars/${a.id}`, { secret: a.editSecret });
    expect(refused.status).toBe(409);
    expect(await code(refused)).toBe("SOLE_GM_OF_SESSIONS");
    // 断られたときは名前を書き写していない
    const snap = await env.DB.prepare("SELECT display_name_snapshot FROM participations WHERE calendar_id = ?1")
      .bind(a.id)
      .first<{ display_name_snapshot: string | null }>();
    expect(snap!.display_name_snapshot).toBeNull();

    // 名前を変える
    expect((await api("PATCH", `/api/calendars/${a.id}`, { secret: a.editSecret, body: { displayName: "新しい名前" } })).status).toBe(200);
    // B が参加し、A が B を GM にする
    const bPart = await joined(s.id, b);
    expect((await patchPart(s.id, bPart, a.editSecret, { role: "GM" })).status).toBe(200);

    expect((await api("DELETE", `/api/calendars/${a.id}`, { secret: a.editSecret })).status).toBe(204);
    const view = await getSession(s.id);
    const gone = view.participants.find((p) => p.calendarDeleted)!;
    expect(gone.displayName).toBe("新しい名前");
    expect(view.participants.map((p) => p.displayName)).not.toContain("古い名前");
  });
});

describe("カレンダーが削除されたGMは、GMの人数に数えない", () => {
  it("残ったGMは自分を PL にできず・抜けられず・カレンダーも消せない。削除されたGMは外せる", async () => {
    const a = await createCalendar("A");
    const b = await createCalendar("B");
    const s = await createSession(a);
    const aPart = s.participants[0]!.id;
    const bPart = await joined(s.id, b);
    expect((await patchPart(s.id, bPart, a.editSecret, { role: "GM" })).status).toBe(200);

    // B は唯一のGMではないので削除できる
    expect((await api("DELETE", `/api/calendars/${b.id}`, { secret: b.editSecret })).status).toBe(204);

    const demote = await patchPart(s.id, aPart, a.editSecret, { role: "PL" });
    expect(demote.status).toBe(409);
    expect(await code(demote)).toBe("LAST_GM");

    const leave = await deletePart(s.id, aPart, a.editSecret);
    expect(leave.status).toBe(409);
    expect(await code(leave)).toBe("LAST_GM");

    const del = await api("DELETE", `/api/calendars/${a.id}`, { secret: a.editSecret });
    expect(del.status).toBe(409);
    const err = await del.json<{ error: { code: string; details: { sessions: { id: string }[] } } }>();
    expect(err.error.code).toBe("SOLE_GM_OF_SESSIONS");
    expect(err.error.details.sessions.map((x) => x.id)).toEqual([s.id]);

    // 削除された B は PL にでき、外すこともできる
    const bDemote = await patchPart(s.id, bPart, a.editSecret, { role: "PL" });
    expect(bDemote.status).toBe(200);
    expect((await bDemote.json<{ role: string }>()).role).toBe("PL");
    expect((await deletePart(s.id, bPart, a.editSecret)).status).toBe(204);
    expect((await getSession(s.id)).participants.map((p) => p.id)).toEqual([aPart]);
  });

  it("削除されたGMは、PL にしなくても外せる", async () => {
    const a = await createCalendar("A");
    const b = await createCalendar("B");
    const s = await createSession(a);
    const bPart = await joined(s.id, b);
    await patchPart(s.id, bPart, a.editSecret, { role: "GM" });
    await api("DELETE", `/api/calendars/${b.id}`, { secret: b.editSecret });
    expect((await deletePart(s.id, bPart, a.editSecret)).status).toBe(204);
  });
});

/** DB に直接、卓と参加者を入れる(同時操作のテスト用) */
async function seedSession(memberCount: number, gmCount = 1): Promise<{ sessionId: string; partIds: string[] }> {
  const sessionId = newSessionId();
  const t = new Date().toISOString();
  const partIds: string[] = [];
  const stmts = [
    env.DB.prepare(
      `INSERT INTO sessions (id, title, candidate_dates, confirmed_dates, last_date, archived_at, created_at, updated_at)
       VALUES (?1, '同時操作の卓', ?2, '[]', ?3, NULL, ?4, ?4)`,
    ).bind(sessionId, JSON.stringify([day(3)]), day(3), t),
  ];
  for (let i = 0; i < memberCount; i++) {
    const cal = await createCalendar(`P${i}`);
    const pid = newParticipationId();
    partIds.push(pid);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO participations (id, session_id, calendar_id, role, display_name_override, joined_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5)`,
      ).bind(pid, sessionId, cal.id, i < gmCount ? "GM" : "PL", t),
    );
  }
  await env.DB.batch(stmts);
  return { sessionId, partIds };
}

async function countParticipants(sessionId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM participations WHERE session_id = ?1")
    .bind(sessionId)
    .first<{ n: number }>();
  return row!.n;
}

describe("同時に操作しても決まりは崩れない(SQL の条件の確認)", () => {
  it("28人の卓に3人が同時に参加しても、30人で止まる", async () => {
    const { sessionId } = await seedSession(28);
    const newcomers = [await createCalendar("x1"), await createCalendar("x2"), await createCalendar("x3")];
    const results = await Promise.all(
      newcomers.map((c) =>
        insertParticipant(env.DB, {
          id: newParticipationId(),
          sessionId,
          calendarId: c.id,
          displayName: null,
          now: new Date().toISOString(),
          max: 30,
        }),
      ),
    );
    expect(results.filter((r) => r === "joined")).toHaveLength(2);
    expect(results.filter((r) => r === "full")).toHaveLength(1);
    expect(await countParticipants(sessionId)).toBe(30);
  });

  it("GM 2人が同時に抜けても、片方だけが抜けてGMは1人残る", async () => {
    const { sessionId, partIds } = await seedSession(2, 2);
    const results = await Promise.all(partIds.map((pid) => deleteParticipant(env.DB, pid, sessionId)));
    expect([...results].sort()).toEqual(["last_gm", "ok"]);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM participations WHERE session_id = ?1 AND role = 'GM'")
      .bind(sessionId)
      .first<{ n: number }>();
    expect(row!.n).toBe(1);
  });
});

describe("記録になった卓は、SQL の段階でも変えない(卓の変更・参加)", () => {
  it("updateSession は false を返し、insertParticipant は archived を返す。行は変わらない", async () => {
    const { sessionId } = await seedSession(1);
    await env.DB.prepare("UPDATE sessions SET archived_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), sessionId).run();
    const before = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?1").bind(sessionId).first();

    const updated = await updateSession(env.DB, sessionId, {
      title: "変えた",
      candidateDates: [day(4)],
      confirmedDates: [day(4)],
      timeWindow: null,
      dateTimes: {},
      now: new Date().toISOString(),
    });
    expect(updated).toBe(false);
    expect(await env.DB.prepare("SELECT * FROM sessions WHERE id = ?1").bind(sessionId).first()).toEqual(before);

    const cal = await createCalendar("あとから");
    const joinedResult = await insertParticipant(env.DB, {
      id: newParticipationId(),
      sessionId,
      calendarId: cal.id,
      displayName: null,
      now: new Date().toISOString(),
      max: 30,
    });
    expect(joinedResult).toBe("archived");
    expect(await countParticipants(sessionId)).toBe(1);
  });
});

describe("卓の API の 403・404", () => {
  it("参加していない人は、卓の変更・削除ができない(403)", async () => {
    const gm = await createCalendar("GM");
    const outsider = await createCalendar("部外者");
    const s = await createSession(gm);
    expect((await api("PATCH", `/api/sessions/${s.id}`, { secret: outsider.editSecret, body: { title: "乗っ取り" } })).status).toBe(403);
    expect((await api("DELETE", `/api/sessions/${s.id}`, { secret: outsider.editSecret })).status).toBe(403);
    expect((await getSession(s.id)).title).toBe("テスト卓");
  });

  it("ない卓には参加できない(404)", async () => {
    const cal = await createCalendar();
    const res = await api("POST", `/api/sessions/ses_${"Q".repeat(22)}/participants`, { secret: cal.editSecret, body: {} });
    expect(res.status).toBe(404);
  });

  it("参加IDの形が違うと 404", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm);
    expect((await patchPart(s.id, "prt_bad", gm.editSecret, { displayName: "x" })).status).toBe(404);
    expect((await deletePart(s.id, "not-an-id", gm.editSecret)).status).toBe(404);
  });

  it("ほかの卓の参加IDで役割・名前を変えようとすると 404。相手の卓は変わらない", async () => {
    const gmA = await createCalendar("GMのA");
    const gmB = await createCalendar("GMのB");
    const pl = await createCalendar("PL");
    const a = await createSession(gmA);
    const b = await createSession(gmB);
    const plInB = await joined(b.id, pl);
    expect((await patchPart(a.id, plInB, gmA.editSecret, { role: "GM" })).status).toBe(404);
    expect((await patchPart(a.id, plInB, gmA.editSecret, { displayName: "x" })).status).toBe(404);
    expect((await getSession(b.id)).participants.find((p) => p.id === plInB)).toMatchObject({ role: "PL", displayName: "PL" });
  });
});

describe("役割と名前を一度に変える", () => {
  it("両方とも反映される", async () => {
    const gm = await createCalendar("GM");
    const pl = await createCalendar("PL");
    const s = await createSession(gm);
    const plPart = await joined(s.id, pl);
    const res = await patchPart(s.id, plPart, gm.editSecret, { role: "GM", displayName: "副GM" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: plPart, role: "GM", displayName: "副GM" });
    expect((await getSession(s.id)).participants.find((p) => p.id === plPart)).toMatchObject({ role: "GM", displayName: "副GM" });
  });
});
