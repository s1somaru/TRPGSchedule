// 卓 API のテスト(spec.md 5.6 / 7.1 / 10.3)
// 作成・取得・参加・役割と名前・卓の変更・外す抜ける・削除・記録になった卓・同時操作
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import { ID_PATTERNS, newParticipationId, newSecret, newSessionId } from "../src/shared/ids";
import type { CalendarCreatedResponse, SessionResponse } from "../src/shared/types";
import { deleteParticipant, insertParticipant, updateParticipantName, updateRole, updateSession } from "../src/server/db-sessions";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

async function createSession(
  gm: CalendarCreatedResponse,
  body: Record<string, unknown> = { title: "クトゥルフ第3回", candidateDates: [day(5), day(3)] },
): Promise<SessionResponse> {
  const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body });
  if (res.status !== 201) throw new Error(`卓の作成に失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function join(sessionId: string, cal: CalendarCreatedResponse, body: Record<string, unknown> = {}) {
  return api("POST", `/api/sessions/${sessionId}/participants`, { secret: cal.editSecret, body });
}

async function joined(sessionId: string, cal: CalendarCreatedResponse, body: Record<string, unknown> = {}) {
  const res = await join(sessionId, cal, body);
  if (res.status !== 201) throw new Error(`参加に失敗: ${res.status} ${await res.text()}`);
  return res.json<{ id: string; role: string }>();
}

async function getSession(id: string, secret?: string): Promise<SessionResponse> {
  const res = await api("GET", `/api/sessions/${id}`, { secret });
  if (res.status !== 200) throw new Error(`取得に失敗: ${res.status}`);
  return res.json();
}

async function code(res: Response): Promise<string> {
  return (await res.json<{ error: { code: string } }>()).error.code;
}

/** GM と PL がいる卓を用意する */
async function setup() {
  const gm = await createCalendar("GM");
  const pl = await createCalendar("PL");
  const s = await createSession(gm);
  const plPart = await joined(s.id, pl);
  const gmPart = s.participants[0]!;
  return { gm, pl, s, plPart, gmPart };
}

const patchPart = (sid: string, pid: string, secret: string, body: unknown) =>
  api("PATCH", `/api/sessions/${sid}/participants/${pid}`, { secret, body });
const deletePart = (sid: string, pid: string, secret: string) =>
  api("DELETE", `/api/sessions/${sid}/participants/${pid}`, { secret });

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

describe("卓の作成", () => {
  it("作成者が GM として参加し、候補日は日付順になる", async () => {
    const gm = await createCalendar("KP");
    const s = await createSession(gm, {
      title: "卓",
      candidateDates: [day(9), day(2), day(5)],
      displayName: "KPたろう",
    });
    expect(s.id).toMatch(ID_PATTERNS.session);
    expect(s.candidateDates).toEqual([day(2), day(5), day(9)]);
    expect(s.confirmedDates).toEqual([]);
    expect(s.participants).toHaveLength(1);
    expect(s.participants[0]).toMatchObject({ role: "GM", displayName: "KPたろう", calendarDeleted: false });
    expect(s.me).toEqual({ participantId: s.participants[0]!.id, role: "GM" });
  });

  it("秘密がないと作れない", async () => {
    const res = await api("POST", "/api/sessions", { body: { title: "卓", candidateDates: [day(1)] } });
    expect(res.status).toBe(401);
  });

  it("候補日の数・重複・範囲をチェックする", async () => {
    const gm = await createCalendar();
    const send = (candidateDates: string[]) =>
      api("POST", "/api/sessions", { secret: gm.editSecret, body: { title: "卓", candidateDates } });
    expect((await send([])).status).toBe(422);
    expect((await send([day(1), day(1)])).status).toBe(422);
    expect((await send(Array.from({ length: 61 }, (_, i) => day(i + 1)))).status).toBe(422);
    expect((await send(Array.from({ length: 60 }, (_, i) => day(i + 1)))).status).toBe(201);
    const out = await send([day(1), day(-3)]);
    expect(out.status).toBe(422);
    expect(await code(out)).toBe("DATE_OUT_OF_RANGE");
  });

  it("タイトルが空・長すぎると 422", async () => {
    const gm = await createCalendar();
    for (const title of ["", "あ".repeat(101)]) {
      const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body: { title, candidateDates: [day(1)] } });
      expect(res.status).toBe(422);
    }
  });
});

describe("卓の取得", () => {
  it("候補日の予定だけを返し、calendarId と最終更新日時は返さない", async () => {
    const gm = await createCalendar("GM");
    await api("PUT", `/api/calendars/${gm.id}/availability`, {
      secret: gm.editSecret,
      body: { availability: { [day(3)]: { s: "o", memo: "夜なら" }, [day(4)]: { s: "x" }, [day(5)]: { s: "t" } } },
    });
    const s = await createSession(gm, { title: "卓", candidateDates: [day(3), day(5)] });
    const res = await api("GET", `/api/sessions/${s.id}`);
    const text = await res.text();
    expect(text).not.toContain(gm.id);
    expect(text).not.toContain("calendarId");
    expect(text).not.toContain("lastUpdatedAt");
    const body = JSON.parse(text) as SessionResponse;
    expect(body.participants[0]!.availability).toEqual({
      [day(3)]: { s: "o", memo: "夜なら" },
      [day(5)]: { s: "t" },
    });
    expect(body.me).toBeNull();
  });

  it("カレンダーを変えると、卓の表示にもすぐ反映される", async () => {
    const { pl, s } = await setup();
    await api("PUT", `/api/calendars/${pl.id}/availability`, {
      secret: pl.editSecret,
      body: { availability: { [day(3)]: { s: "x" } } },
    });
    const body = await getSession(s.id);
    expect(body.participants.find((p) => p.displayName === "PL")!.availability).toEqual({ [day(3)]: { s: "x" } });
  });

  it("参加者の秘密を付けると me が入る。参加していない人の秘密なら null", async () => {
    const { pl, s, plPart } = await setup();
    expect((await getSession(s.id, pl.editSecret)).me).toEqual({ participantId: plPart.id, role: "PL" });
    const other = await createCalendar();
    expect((await getSession(s.id, other.editSecret)).me).toBeNull();
  });

  it("間違った秘密を付けると 401、ない卓は 404", async () => {
    const { s } = await setup();
    expect((await api("GET", `/api/sessions/${s.id}`, { secret: newSecret() })).status).toBe(401);
    expect((await api("GET", `/api/sessions/${s.id}`, { headers: { Authorization: "Basic abc" } })).status).toBe(401);
    expect((await api("GET", "/api/sessions/ses_AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await api("GET", "/api/sessions/new")).status).toBe(404);
  });

  it("GM が先、その中は参加した順に並ぶ", async () => {
    const { gm, s } = await setup();
    const pl2 = await createCalendar("PL2");
    const p2 = await joined(s.id, pl2);
    const pl3 = await createCalendar("PL3");
    await joined(s.id, pl3);
    // 参加した時刻が同じミリ秒になると順番が決まらないので、参加した順に1秒ずつ違う時刻にしておく
    const names = ["GM", "PL", "PL2", "PL3"];
    for (const [i, name] of names.entries()) {
      await env.DB.prepare(
        `UPDATE participations SET joined_at = ?1
         WHERE session_id = ?2 AND calendar_id = (SELECT id FROM calendars WHERE id = participations.calendar_id AND display_name = ?3)`,
      )
        .bind(new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), s.id, name)
        .run();
    }
    await api("PATCH", `/api/sessions/${s.id}/participants/${p2.id}`, { secret: gm.editSecret, body: { role: "GM" } });
    expect((await getSession(s.id)).participants.map((p) => p.displayName)).toEqual(["GM", "PL2", "PL", "PL3"]);
  });
});

describe("参加", () => {
  it("本人の秘密で参加すると、必ず PL になる", async () => {
    const { s, plPart } = await setup();
    expect(plPart.role).toBe("PL");
    expect(plPart.id).toMatch(ID_PATTERNS.participation);
    expect((await getSession(s.id)).participants).toHaveLength(2);
  });

  it("role を送っても GM にはなれない(知らない項目として 400)", async () => {
    const { s } = await setup();
    const x = await createCalendar();
    expect((await join(s.id, x, { role: "GM" })).status).toBe(400);
  });

  it("この卓での名前を付けて参加できる", async () => {
    const { s } = await setup();
    const x = await createCalendar("本名");
    await joined(s.id, x, { displayName: "PC名:ジョン" });
    expect((await getSession(s.id)).participants.map((p) => p.displayName)).toContain("PC名:ジョン");
  });

  it("同じカレンダーで二重に参加すると 409", async () => {
    const { s, pl } = await setup();
    const res = await join(s.id, pl);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("ALREADY_JOINED");
  });

  it("共有トークンでは参加できない(止めている)", async () => {
    const { s } = await setup();
    const res = await api("POST", `/api/sessions/${s.id}/participants`, {
      body: { shareToken: `shr_${"A".repeat(43)}` },
    });
    expect(res.status).toBe(401);
    const x = await createCalendar();
    // 秘密と一緒に送っても、知らない項目として断る
    expect((await join(s.id, x, { shareToken: `shr_${"A".repeat(43)}` })).status).toBe(400);
  });

  it("秘密がないと参加できない(401)", async () => {
    const { s } = await setup();
    expect((await api("POST", `/api/sessions/${s.id}/participants`, { body: {} })).status).toBe(401);
  });

  it("30人を超えると 409", async () => {
    const gm = await createCalendar();
    const s = await createSession(gm);
    for (let i = 0; i < 29; i++) await joined(s.id, await createCalendar(`P${i}`));
    const res = await join(s.id, await createCalendar("31人目"));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("SESSION_FULL");
  });

  it("再発行しても、参加中の卓はそのまま見える", async () => {
    const { s, pl, plPart } = await setup();
    const next = newSecret();
    await api("POST", `/api/calendars/${pl.id}/edit-secret`, { secret: pl.editSecret, body: { newSecret: next } });
    expect((await getSession(s.id, next)).me).toEqual({ participantId: plPart.id, role: "PL" });
  });
});

describe("役割の変更", () => {
  it("PL は役割を変えられない", async () => {
    const { s, pl, plPart } = await setup();
    const res = await api("PATCH", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: pl.editSecret, body: { role: "GM" } });
    expect(res.status).toBe(403);
  });

  it("GM は PL を GM にでき、新しい GM も GM 操作ができる", async () => {
    const { s, gm, pl, plPart } = await setup();
    const res = await api("PATCH", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret, body: { role: "GM" } });
    expect(res.status).toBe(200);
    expect((await res.json<{ role: string }>()).role).toBe("GM");
    const patch = await api("PATCH", `/api/sessions/${s.id}`, { secret: pl.editSecret, body: { title: "共同GMが変更" } });
    expect(patch.status).toBe(200);
  });

  it("最後の GM は PL にできない", async () => {
    const { s, gm, gmPart } = await setup();
    const res = await api("PATCH", `/api/sessions/${s.id}/participants/${gmPart.id}`, { secret: gm.editSecret, body: { role: "PL" } });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("LAST_GM");
  });

  it("DB の処理を本当に同時に呼んでも、GM は0人にならない(SQL の条件の確認)", async () => {
    const { s, gm, plPart, gmPart } = await setup();
    await api("PATCH", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret, body: { role: "GM" } });
    const results = await Promise.all([
      updateRole(env.DB, plPart.id, s.id, "PL"),
      updateRole(env.DB, gmPart.id, s.id, "PL"),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect((await getSession(s.id)).participants.filter((p) => p.role === "GM")).toHaveLength(1);
  });
});

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

describe("この卓での名前", () => {
  it("本人と GM は変えられ、ほかの PL は変えられない。null で元に戻る", async () => {
    const { s, gm, pl, plPart } = await setup();
    const other = await createCalendar("他人");
    await joined(s.id, other);
    const url = `/api/sessions/${s.id}/participants/${plPart.id}`;

    expect((await api("PATCH", url, { secret: other.editSecret, body: { displayName: "いたずら" } })).status).toBe(403);
    const self = await api("PATCH", url, { secret: pl.editSecret, body: { displayName: "PC名" } });
    expect((await self.json<{ displayName: string }>()).displayName).toBe("PC名");
    const byGm = await api("PATCH", url, { secret: gm.editSecret, body: { displayName: "GMが付けた名前" } });
    expect(byGm.status).toBe(200);
    const reset = await api("PATCH", url, { secret: pl.editSecret, body: { displayName: null } });
    expect((await reset.json<{ displayName: string }>()).displayName).toBe("PL");
  });

  it("参加していない人は変えられない", async () => {
    const { s, plPart } = await setup();
    const outsider = await createCalendar();
    const res = await api("PATCH", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: outsider.editSecret, body: { displayName: "x" } });
    expect(res.status).toBe(403);
  });
});

describe("役割と名前を一度に変える", () => {
  it("両方とも反映される", async () => {
    const gm = await createCalendar("GM");
    const pl = await createCalendar("PL");
    const s = await createSession(gm);
    const plPart = (await joined(s.id, pl)).id;
    const res = await patchPart(s.id, plPart, gm.editSecret, { role: "GM", displayName: "副GM" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: plPart, role: "GM", displayName: "副GM" });
    expect((await getSession(s.id)).participants.find((p) => p.id === plPart)).toMatchObject({ role: "GM", displayName: "副GM" });
  });
});

describe("卓の変更と日程確定", () => {
  it("PL は卓の内容を変えられない", async () => {
    const { s, pl } = await setup();
    expect((await api("PATCH", `/api/sessions/${s.id}`, { secret: pl.editSecret, body: { title: "x" } })).status).toBe(403);
  });

  it("GM はタイトル・候補日を変え、開催日を決めて取り消せる", async () => {
    const { s, gm } = await setup();
    const url = `/api/sessions/${s.id}`;
    let res = await api("PATCH", url, { secret: gm.editSecret, body: { title: "新タイトル", candidateDates: [day(3), day(5), day(7)] } });
    let body = await res.json<SessionResponse>();
    expect(body.title).toBe("新タイトル");
    expect(body.candidateDates).toEqual([day(3), day(5), day(7)]);

    res = await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(5)] } });
    body = await res.json<SessionResponse>();
    expect(body.confirmedDates).toEqual([day(5)]);
    const row = await env.DB.prepare("SELECT last_date FROM sessions WHERE id = ?1").bind(s.id).first<{ last_date: string }>();
    expect(row!.last_date).toBe(day(5));

    res = await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [] } });
    expect((await res.json<SessionResponse>()).confirmedDates).toEqual([]);
  });

  it("開催日は複数決められ、日付順になる。記録の基準日は一番遅い開催日", async () => {
    const { s, gm } = await setup();
    const url = `/api/sessions/${s.id}`;
    await api("PATCH", url, { secret: gm.editSecret, body: { candidateDates: [day(3), day(5), day(7)] } });
    const res = await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(7), day(3)] } });
    expect((await res.json<SessionResponse>()).confirmedDates).toEqual([day(3), day(7)]);
    const row = await env.DB.prepare("SELECT last_date FROM sessions WHERE id = ?1").bind(s.id).first<{ last_date: string }>();
    expect(row!.last_date).toBe(day(7));
    // 同じ日を2回は入れられない
    const dup = await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(3), day(3)] } });
    expect(dup.status).toBe(422);
  });

  it("候補日にない日は開催日にできず、開催日を候補日から外すこともできない", async () => {
    const { s, gm } = await setup();
    const url = `/api/sessions/${s.id}`;
    let res = await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(3), day(4)] } });
    expect(await code(res)).toBe("CONFIRMED_DATE_NOT_IN_CANDIDATES");

    await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(3)] } });
    res = await api("PATCH", url, { secret: gm.editSecret, body: { candidateDates: [day(5)] } });
    expect(await code(res)).toBe("CONFIRMED_DATE_NOT_IN_CANDIDATES");
    // 開催日を残せば、ほかの候補日は自由に変えられる
    res = await api("PATCH", url, { secret: gm.editSecret, body: { candidateDates: [day(3), day(8)] } });
    expect(res.status).toBe(200);
  });

  it("新しく足す日は範囲チェックするが、すでにある過去の候補日は残せる", async () => {
    const { s, gm } = await setup();
    // 候補日が過去になった状態を作る
    await env.DB.prepare("UPDATE sessions SET candidate_dates = ?1 WHERE id = ?2")
      .bind(JSON.stringify([day(-2), day(3)]), s.id)
      .run();
    const url = `/api/sessions/${s.id}`;
    expect((await api("PATCH", url, { secret: gm.editSecret, body: { candidateDates: [day(-2), day(3), day(4)] } })).status).toBe(200);
    const res = await api("PATCH", url, { secret: gm.editSecret, body: { candidateDates: [day(-2), day(-5)] } });
    expect(await code(res)).toBe("DATE_OUT_OF_RANGE");
    // 過去の候補日も開催日にできる
    expect((await api("PATCH", url, { secret: gm.editSecret, body: { confirmedDates: [day(-2)] } })).status).toBe(200);
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

describe("外す・抜ける", () => {
  it("PL は自分で抜けられるが、ほかの人は外せない", async () => {
    const { s, pl, gmPart } = await setup();
    const other = await createCalendar();
    const otherPart = await joined(s.id, other);
    expect((await api("DELETE", `/api/sessions/${s.id}/participants/${otherPart.id}`, { secret: pl.editSecret })).status).toBe(403);
    expect((await api("DELETE", `/api/sessions/${s.id}/participants/${gmPart.id}`, { secret: pl.editSecret })).status).toBe(403);
    const me = (await getSession(s.id, pl.editSecret)).me!;
    expect((await api("DELETE", `/api/sessions/${s.id}/participants/${me.participantId}`, { secret: pl.editSecret })).status).toBe(204);
  });

  it("GM は PL を外せる。最後の GM は抜けられない", async () => {
    const { s, gm, plPart, gmPart } = await setup();
    expect((await api("DELETE", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret })).status).toBe(204);
    const res = await api("DELETE", `/api/sessions/${s.id}/participants/${gmPart.id}`, { secret: gm.editSecret });
    expect(await code(res)).toBe("LAST_GM");
  });

  it("ほかの卓の参加IDは 404", async () => {
    const a = await setup();
    const b = await setup();
    const res = await api("DELETE", `/api/sessions/${a.s.id}/participants/${b.plPart.id}`, { secret: a.gm.editSecret });
    expect(res.status).toBe(404);
  });
});

describe("卓の API の 403・404", () => {
  it("参加していない人は、卓の変更・削除ができない(403)", async () => {
    const gm = await createCalendar("GM");
    const outsider = await createCalendar("部外者");
    const s = await createSession(gm);
    expect((await api("PATCH", `/api/sessions/${s.id}`, { secret: outsider.editSecret, body: { title: "乗っ取り" } })).status).toBe(403);
    expect((await api("DELETE", `/api/sessions/${s.id}`, { secret: outsider.editSecret })).status).toBe(403);
    expect((await getSession(s.id)).title).toBe("クトゥルフ第3回");
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
    const plInB = (await joined(b.id, pl)).id;
    expect((await patchPart(a.id, plInB, gmA.editSecret, { role: "GM" })).status).toBe(404);
    expect((await patchPart(a.id, plInB, gmA.editSecret, { displayName: "x" })).status).toBe(404);
    expect((await getSession(b.id)).participants.find((p) => p.id === plInB)).toMatchObject({ role: "PL", displayName: "PL" });
  });
});

describe("卓の削除", () => {
  it("PL は削除できず、GM は削除できる。参加情報も消える", async () => {
    const { s, gm, pl } = await setup();
    expect((await api("DELETE", `/api/sessions/${s.id}`, { secret: pl.editSecret })).status).toBe(403);
    expect((await api("DELETE", `/api/sessions/${s.id}`, { secret: gm.editSecret })).status).toBe(204);
    expect((await api("GET", `/api/sessions/${s.id}`)).status).toBe(404);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM participations WHERE session_id = ?1").bind(s.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe("記録になった卓", () => {
  async function archive(id: string) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE participations SET display_name_snapshot = COALESCE(display_name_override,
           (SELECT display_name FROM calendars WHERE id = participations.calendar_id)) WHERE session_id = ?1`,
      ).bind(id),
      env.DB.prepare("UPDATE sessions SET archived_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), id),
    ]);
  }

  it("予定は見えず、書き写した名前が出る。変更・参加はできず、GM は削除できる", async () => {
    const { s, gm, pl, plPart } = await setup();
    await api("PUT", `/api/calendars/${pl.id}/availability`, { secret: pl.editSecret, body: { availability: { [day(3)]: { s: "o" } } } });
    await archive(s.id);
    // 記録になったあとで名前を変えても、記録の名前は変わらない
    await api("PATCH", `/api/calendars/${pl.id}`, { secret: pl.editSecret, body: { displayName: "改名後" } });

    const body = await getSession(s.id);
    expect(body.archived).toBe(true);
    expect(body.participants.map((p) => p.displayName)).toEqual(["GM", "PL"]);
    expect(body.participants.every((p) => Object.keys(p.availability).length === 0 && !("lastUpdatedAt" in p))).toBe(true);

    expect(await code(await api("PATCH", `/api/sessions/${s.id}`, { secret: gm.editSecret, body: { title: "x" } }))).toBe("SESSION_ARCHIVED");
    expect(await code(await join(s.id, await createCalendar()))).toBe("SESSION_ARCHIVED");
    expect(await code(await api("DELETE", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret }))).toBe("SESSION_ARCHIVED");
    expect((await api("DELETE", `/api/sessions/${s.id}`, { secret: gm.editSecret })).status).toBe(204);
  });
});

describe("カレンダーが削除された参加者", () => {
  it("名前は残り「削除済み」になる。GM にはできないが、外すことはできる", async () => {
    const { s, gm, pl, plPart } = await setup();
    expect((await api("DELETE", `/api/calendars/${pl.id}`, { secret: pl.editSecret })).status).toBe(204);
    const body = await getSession(s.id);
    const gone = body.participants.find((p) => p.id === plPart.id)!;
    expect(gone).toMatchObject({ displayName: "PL", calendarDeleted: true, availability: {} });

    const promote = await api("PATCH", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret, body: { role: "GM" } });
    expect(promote.status).toBe(422);
    expect((await api("DELETE", `/api/sessions/${s.id}/participants/${plPart.id}`, { secret: gm.editSecret })).status).toBe(204);
  });
});

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
    const bPart = (await joined(s.id, b)).id;
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
    const bPart = (await joined(s.id, b)).id;
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
    const bPart = (await joined(s.id, b)).id;
    await patchPart(s.id, bPart, a.editSecret, { role: "GM" });
    await api("DELETE", `/api/calendars/${b.id}`, { secret: b.editSecret });
    expect((await deletePart(s.id, bPart, a.editSecret)).status).toBe(204);
  });
});

describe("記録になった卓は、書き込みの SQL の段階でも変えない", () => {
  it("確かめたあとに記録になっても、役割・名前・外す操作は通らない", async () => {
    const { s, plPart } = await setup();
    await env.DB.prepare("UPDATE sessions SET archived_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), s.id).run();
    expect(await updateRole(env.DB, plPart.id, s.id, "GM")).toBe("archived");
    expect(await updateParticipantName(env.DB, plPart.id, s.id, "x")).toBe(false);
    expect(await deleteParticipant(env.DB, plPart.id, s.id)).toBe("archived");
    const row = await env.DB.prepare("SELECT role, display_name_override FROM participations WHERE id = ?1").bind(plPart.id).first();
    expect(row).toEqual({ role: "PL", display_name_override: null });
  });

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
