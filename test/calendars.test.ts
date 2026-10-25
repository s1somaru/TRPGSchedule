// 個人カレンダー API のテスト(spec.md 5.5 / 10.3)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import { ID_PATTERNS, newParticipationId, newSecret } from "../src/shared/ids";
import type { CalendarResponse, MySessionsResponse } from "../src/shared/types";
import { api, createCalendar, freshIp } from "./helpers";

const today = () => jstNow().today;
const day = (n: number) => addDays(today(), n);

async function putAvailability(id: string, secret: string, availability: unknown) {
  return api("PUT", `/api/calendars/${id}/availability`, { secret, body: { availability } });
}

describe("作成と取得", () => {
  it("作成すると ID と秘密が返り、秘密はハッシュだけが保存される", async () => {
    const cal = await createCalendar("たろう");
    expect(cal.id).toMatch(ID_PATTERNS.calendar);
    expect(cal.editSecret).toMatch(ID_PATTERNS.secret);
    expect(cal.displayName).toBe("たろう");
    expect(cal.availability).toEqual({});
    expect(cal.inputRange.from).toBe(today());

    const row = await env.DB.prepare("SELECT * FROM calendars WHERE id = ?1").bind(cal.id).first();
    expect(JSON.stringify(row)).not.toContain(cal.editSecret);
  });

  it("取得の応答に秘密は入らない", async () => {
    const cal = await createCalendar();
    const res = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("editSecret");
  });

  it("秘密がないと取得できない", async () => {
    const cal = await createCalendar();
    const res = await api("GET", `/api/calendars/${cal.id}`);
    expect(res.status).toBe(401);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("UNAUTHORIZED");
  });

  it("他人の秘密では取得も変更もできない", async () => {
    const a = await createCalendar("A");
    const b = await createCalendar("B");
    expect((await api("GET", `/api/calendars/${a.id}`, { secret: b.editSecret })).status).toBe(401);
    expect((await putAvailability(a.id, b.editSecret, { [day(1)]: { s: "o" } })).status).toBe(401);
    expect(
      (await api("PATCH", `/api/calendars/${a.id}`, { secret: b.editSecret, body: { displayName: "x" } }))
        .status,
    ).toBe(401);
  });

  it("存在しないカレンダーも、秘密違いと同じく 401 になる", async () => {
    const res = await api("GET", "/api/calendars/cal_AAAAAAAAAAAAAAAAAAAAAA", { secret: newSecret() });
    expect(res.status).toBe(401);
  });
});

describe("入力チェック", () => {
  it("名前が空・長すぎると 422", async () => {
    for (const displayName of ["", "   ", "あ".repeat(21)]) {
      const res = await api("POST", "/api/calendars", { body: { displayName } });
      expect(res.status).toBe(422);
    }
  });

  it("名前は見た目の文字数で数える(絵文字20個は OK)", async () => {
    const res = await api("POST", "/api/calendars", { body: { displayName: "👨‍👩‍👧".repeat(20) } });
    expect(res.status).toBe(201);
  });

  it("文字の向きを変える特殊文字と制御文字は取り除かれる", async () => {
    const cal = await createCalendar("ab‮cd\u0007e");
    expect(cal.displayName).toBe("abcde");
  });

  it("知らない項目があると 400、JSON が壊れていると 400", async () => {
    expect((await api("POST", "/api/calendars", { body: { displayName: "a", admin: true } })).status).toBe(400);
    const broken = await api("POST", "/api/calendars", {
      rawBody: "{broken",
      headers: { "Content-Type": "application/json" },
    });
    expect(broken.status).toBe(400);
  });

  it("SQL に使われる記号も、ただの文字として保存される", async () => {
    const name = `'; DROP TABLE x;--`;
    const cal = await createCalendar(name);
    expect(cal.displayName).toBe(name);
    const memo = `"); DELETE FROM calendars; --`;
    const res = await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o", memo } });
    expect((await res.json<CalendarResponse>()).availability[day(1)]).toEqual({ s: "o", memo });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM calendars").first<{ n: number }>();
    expect(count!.n).toBeGreaterThan(0);
  });

  it("HTML のタグも文字のまま保存される(表示側で文字として出す)", async () => {
    const cal = await createCalendar("<b onclick=x>a</b>");
    expect(cal.displayName).toBe("<b onclick=x>a</b>");
  });

  it("不正な日付のキーは 422", async () => {
    const cal = await createCalendar();
    const res = await putAvailability(cal.id, cal.editSecret, { "2026-02-30": { s: "o" } });
    expect(res.status).toBe(422);
  });
});

describe("予定の更新", () => {
  it("記号とメモを保存でき、null で消せる", async () => {
    const cal = await createCalendar();
    let res = await putAvailability(cal.id, cal.editSecret, {
      [day(1)]: { s: "o" },
      [day(2)]: { s: "t", memo: "21時から\n遅れるかも" },
    });
    expect(res.status).toBe(200);
    let body = await res.json<CalendarResponse>();
    expect(body.availability).toEqual({
      [day(1)]: { s: "o" },
      [day(2)]: { s: "t", memo: "21時から\n遅れるかも" },
    });

    res = await putAvailability(cal.id, cal.editSecret, { [day(1)]: null });
    body = await res.json<CalendarResponse>();
    expect(body.availability).toEqual({ [day(2)]: { s: "t", memo: "21時から\n遅れるかも" } });
  });

  it("1日分は丸ごと置き換わる(記号だけ送るとメモは消える)", async () => {
    const cal = await createCalendar();
    await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "t", memo: "メモ" } });
    const res = await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "x" } });
    expect((await res.json<CalendarResponse>()).availability[day(1)]).toEqual({ s: "x" });
  });

  it("メモは100文字まで、空白だけのメモは付かない", async () => {
    const cal = await createCalendar();
    expect((await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o", memo: "あ".repeat(100) } })).status).toBe(200);
    expect((await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o", memo: "あ".repeat(101) } })).status).toBe(422);
    const res = await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o", memo: "  \n " } });
    expect((await res.json<CalendarResponse>()).availability[day(1)]).toEqual({ s: "o" });
  });

  it("範囲外の日が1つでもあれば、全体が保存されない", async () => {
    const cal = await createCalendar();
    const res = await putAvailability(cal.id, cal.editSecret, {
      [day(1)]: { s: "o" },
      [day(-2)]: { s: "o" },
      [day(400)]: { s: "o" },
    });
    expect(res.status).toBe(422);
    const err = await res.json<{ error: { code: string; details: { dates: string[] } } }>();
    expect(err.error.code).toBe("DATE_OUT_OF_RANGE");
    expect(err.error.details.dates).toEqual([day(-2), day(400)]);

    const get = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret });
    expect((await get.json<CalendarResponse>()).availability).toEqual({});
  });

  it("同時に別の日を保存しても、両方残る", async () => {
    const cal = await createCalendar();
    const changes = Array.from({ length: 10 }, (_, i) => ({ [day(i + 1)]: { s: "o" } }));
    await Promise.all(changes.map((ch) => putAvailability(cal.id, cal.editSecret, ch)));
    const get = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret });
    expect(Object.keys((await get.json<CalendarResponse>()).availability)).toHaveLength(10);
  });

  it("90日より古い予定は、次の保存で捨てられる", async () => {
    const cal = await createCalendar();
    await env.DB.prepare("UPDATE calendars SET availability = ?1 WHERE id = ?2")
      .bind(JSON.stringify({ [day(-91)]: { s: "o" }, [day(-30)]: { s: "x" } }), cal.id)
      .run();
    await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "t" } });
    const row = await env.DB.prepare("SELECT availability FROM calendars WHERE id = ?1")
      .bind(cal.id)
      .first<{ availability: string }>();
    expect(Object.keys(JSON.parse(row!.availability)).sort()).toEqual([day(-30), day(1)]);
  });

  it("保存すると最終更新日時が進む", async () => {
    const cal = await createCalendar();
    await new Promise((r) => setTimeout(r, 5));
    const res = await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o" } });
    expect((await res.json<CalendarResponse>()).lastUpdatedAt > cal.lastUpdatedAt).toBe(true);
  });
});

describe("表示名の変更", () => {
  it("変更できる", async () => {
    const cal = await createCalendar("前");
    const res = await api("PATCH", `/api/calendars/${cal.id}`, {
      secret: cal.editSecret,
      body: { displayName: "後" },
    });
    expect(res.status).toBe(200);
    expect((await res.json<CalendarResponse>()).displayName).toBe("後");
  });
});

describe("編集URLの再発行", () => {
  it("再発行すると古い秘密は使えず、新しい秘密で使える。予定はそのまま", async () => {
    const cal = await createCalendar();
    await putAvailability(cal.id, cal.editSecret, { [day(1)]: { s: "o" } });
    const next = newSecret();
    const res = await api("POST", `/api/calendars/${cal.id}/edit-secret`, {
      secret: cal.editSecret,
      body: { newSecret: next },
    });
    expect(res.status).toBe(200);

    expect((await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(401);
    const get = await api("GET", `/api/calendars/${cal.id}`, { secret: next });
    expect(get.status).toBe(200);
    expect((await get.json<CalendarResponse>()).availability).toEqual({ [day(1)]: { s: "o" } });
  });

  it("応答が届かずに同じ内容でやり直しても成功する。別の秘密では失敗する", async () => {
    const cal = await createCalendar();
    const next = newSecret();
    const send = (newS: string) =>
      api("POST", `/api/calendars/${cal.id}/edit-secret`, { secret: cal.editSecret, body: { newSecret: newS } });
    expect((await send(next)).status).toBe(200);
    expect((await send(next)).status).toBe(200);
    expect((await send(newSecret())).status).toBe(401);
  });

  it("再発行すると、それまでの共有トークンの世代が古くなる", async () => {
    const cal = await createCalendar();
    const tokenRes = await api("POST", `/api/calendars/${cal.id}/share-tokens`, { secret: cal.editSecret });
    const { shareToken } = await tokenRes.json<{ shareToken: string }>();
    await api("POST", `/api/calendars/${cal.id}/edit-secret`, {
      secret: cal.editSecret,
      body: { newSecret: newSecret() },
    });
    const stored = await env.SHARE_TOKENS.get<{ generation: number }>(shareToken, "json");
    const row = await env.DB.prepare("SELECT token_generation FROM calendars WHERE id = ?1")
      .bind(cal.id)
      .first<{ token_generation: number }>();
    expect(stored!.generation).toBe(0);
    expect(row!.token_generation).toBe(1);
  });

  it("新しい秘密の形が違うと 422", async () => {
    const cal = await createCalendar();
    const res = await api("POST", `/api/calendars/${cal.id}/edit-secret`, {
      secret: cal.editSecret,
      body: { newSecret: "sec_short" },
    });
    expect(res.status).toBe(422);
  });
});

describe("共有トークン", () => {
  it("発行すると KV に期限つきで保存される", async () => {
    const cal = await createCalendar();
    const res = await api("POST", `/api/calendars/${cal.id}/share-tokens`, {
      secret: cal.editSecret,
      body: { ttlSeconds: 3600 },
    });
    expect(res.status).toBe(201);
    const { shareToken, expiresAt } = await res.json<{ shareToken: string; expiresAt: string }>();
    expect(shareToken).toMatch(ID_PATTERNS.shareToken);
    const diff = new Date(expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(3500_000);
    expect(diff).toBeLessThanOrEqual(3600_000);
    const stored = await env.SHARE_TOKENS.get<{ calendarId: string }>(shareToken, "json");
    expect(stored!.calendarId).toBe(cal.id);
  });

  it("期限の秒数が範囲外だと 422", async () => {
    const cal = await createCalendar();
    for (const ttlSeconds of [59, 86401]) {
      const res = await api("POST", `/api/calendars/${cal.id}/share-tokens`, {
        secret: cal.editSecret,
        body: { ttlSeconds },
      });
      expect(res.status).toBe(422);
    }
  });
});

// 卓の API はまだないので、DB に直接書いて確かめる
async function seedSession(opts: {
  id: string;
  title: string;
  dates: string[];
  confirmed?: string;
  archived?: boolean;
  members: { calendarId: string; role: "GM" | "PL" }[];
}) {
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO sessions (id, title, candidate_dates, confirmed_date, last_date, archived_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    ).bind(
      opts.id,
      opts.title,
      JSON.stringify(opts.dates),
      opts.confirmed ?? null,
      opts.confirmed ?? opts.dates[opts.dates.length - 1],
      opts.archived ? now : null,
      now,
    ),
    ...opts.members.map((m, i) =>
      env.DB.prepare(
        "INSERT INTO participations (id, session_id, calendar_id, role, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(newParticipationId(), opts.id, m.calendarId, m.role, new Date(Date.now() + i).toISOString()),
    ),
  ];
  await env.DB.batch(stmts);
}

const sid = (n: number) => `ses_${String(n).padStart(22, "0")}`;

describe("参加中の卓と、これまでのセッション", () => {
  it("進行中・終わった確定卓・確定しなかった記録を正しく分ける", async () => {
    const me = await createCalendar();
    await seedSession({ id: sid(1), title: "来週の卓", dates: [day(7), day(8)], members: [{ calendarId: me.id, role: "GM" }] });
    await seedSession({ id: sid(2), title: "確定済み", dates: [day(3)], confirmed: day(3), members: [{ calendarId: me.id, role: "PL" }] });
    await seedSession({ id: sid(3), title: "先月の卓", dates: [day(-30)], confirmed: day(-30), members: [{ calendarId: me.id, role: "PL" }] });
    await seedSession({ id: sid(4), title: "昔の記録", dates: [day(-200)], confirmed: day(-200), archived: true, members: [{ calendarId: me.id, role: "GM" }] });
    await seedSession({ id: sid(5), title: "流れた卓", dates: [day(-200)], archived: true, members: [{ calendarId: me.id, role: "PL" }] });

    const res = await api("GET", `/api/calendars/${me.id}/sessions`, { secret: me.editSecret });
    const body = await res.json<MySessionsResponse>();
    expect(body.active.map((s) => s.title)).toEqual(["確定済み", "来週の卓"]);
    expect(body.active[1]).toMatchObject({ role: "GM", firstCandidateDate: day(7), lastCandidateDate: day(8) });
    expect(body.past.map((s) => [s.title, s.archived])).toEqual([
      ["先月の卓", false],
      ["昔の記録", true],
    ]);
  });
});

describe("カレンダーの削除", () => {
  it("削除すると、その秘密は使えなくなる", async () => {
    const cal = await createCalendar();
    expect((await api("DELETE", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(204);
    expect((await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(401);
  });

  it("唯一のGMをしている卓があると削除できない", async () => {
    const gm = await createCalendar("GM");
    const pl = await createCalendar("PL");
    await seedSession({ id: sid(10), title: "ひとりGMの卓", dates: [day(5)], members: [{ calendarId: gm.id, role: "GM" }, { calendarId: pl.id, role: "PL" }] });
    const res = await api("DELETE", `/api/calendars/${gm.id}`, { secret: gm.editSecret });
    expect(res.status).toBe(409);
    const err = await res.json<{ error: { code: string; details: { sessions: { id: string }[] } } }>();
    expect(err.error.code).toBe("SOLE_GM_OF_SESSIONS");
    expect(err.error.details.sessions.map((s) => s.id)).toEqual([sid(10)]);
    // 消えていない
    expect((await api("GET", `/api/calendars/${gm.id}`, { secret: gm.editSecret })).status).toBe(200);
  });

  it("共同GMがいれば削除でき、卓には名前だけが残る", async () => {
    const a = await createCalendar("GMのA");
    const b = await createCalendar("GMのB");
    await seedSession({ id: sid(11), title: "共同GMの卓", dates: [day(5)], members: [{ calendarId: a.id, role: "GM" }, { calendarId: b.id, role: "GM" }] });
    expect((await api("DELETE", `/api/calendars/${a.id}`, { secret: a.editSecret })).status).toBe(204);
    const { results } = await env.DB.prepare(
      "SELECT calendar_id, display_name_snapshot FROM participations WHERE session_id = ?1 ORDER BY joined_at, id",
    )
      .bind(sid(11))
      .all<{ calendar_id: string | null; display_name_snapshot: string | null }>();
    expect(results).toContainEqual({ calendar_id: null, display_name_snapshot: "GMのA" });
  });

  it("記録になった卓は、唯一のGMでも削除の妨げにならない", async () => {
    const gm = await createCalendar("GM");
    await seedSession({ id: sid(12), title: "昔の卓", dates: [day(-200)], archived: true, members: [{ calendarId: gm.id, role: "GM" }] });
    expect((await api("DELETE", `/api/calendars/${gm.id}`, { secret: gm.editSecret })).status).toBe(204);
  });
});

describe("セキュリティの共通処理", () => {
  it("API の応答にセキュリティヘッダが付く(エラーのときも)", async () => {
    for (const res of [
      await api("POST", "/api/calendars", { body: { displayName: "a" } }),
      await api("GET", "/api/calendars/cal_x"),
      await api("GET", "/api/nothing"),
    ]) {
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("別のサイトからの書き込みは 403", async () => {
    const res = await api("POST", "/api/calendars", {
      body: { displayName: "a" },
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("同じサイトからの書き込みは通る", async () => {
    const res = await api("POST", "/api/calendars", {
      body: { displayName: "a" },
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(201);
  });

  it("JSON 以外の形式は 415(フォーム送信を防ぐ)", async () => {
    const res = await api("POST", "/api/calendars", {
      rawBody: "displayName=a",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });

  it("32KB を超えるボディは 413", async () => {
    const res = await api("POST", "/api/calendars", {
      rawBody: JSON.stringify({ displayName: "a".repeat(40_000) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(413);
  });

  it("知らない API は 404 の JSON", async () => {
    const res = await api("GET", "/api/nothing");
    expect(res.status).toBe(404);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("NOT_FOUND");
  });

  it("同じ接続元から作りすぎると 429", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await api("POST", "/api/calendars", { body: { displayName: "a" }, ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
