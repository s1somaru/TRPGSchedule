// ほかの卓の開催日を判定に入れる(design/busy-and-multi-times.md 2)
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import { cellStatus, judgeDate } from "../src/shared/judge";
import { dayTimeLabel, sameDayTime, shortDayTimeLabel, statusForWindow, statusWithBusy, type TimeRange } from "../src/shared/time";
import { emptyHistory, recordChange } from "../src/client/undo";
import type { CalendarCreatedResponse, MySessionsResponse, ParticipantView, SessionResponse, Status } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const R = (from: string, to?: string): TimeRange => (to ? { from, to } : { from });

describe("ほかの卓の開催日を入れた判定", () => {
  // 本人 18:00〜24:00、ほかの卓 20:00〜23:00 で決定
  const mine = R("18:00", "24:00");
  const busy = [R("20:00", "23:00")];

  // 3行目(同じ時間)は、二重に開催日を決めた場合と同じ
  it("設計書の表どおり", () => {
    expect(statusWithBusy("o", mine, R("18:00", "20:00"), busy)).toEqual({ s: "o", adjusted: false, busy: false });
    expect(statusWithBusy("o", mine, R("19:00", "22:00"), busy)).toEqual({ s: "t", adjusted: false, busy: true });
    expect(statusWithBusy("o", mine, R("20:00", "23:00"), busy)).toEqual({ s: "x", adjusted: false, busy: true });
    expect(statusWithBusy("o", mine, R("21:00"), busy)).toEqual({ s: "t", adjusted: true, busy: true });
    expect(statusWithBusy("o", mine, undefined, busy)).toEqual({ s: "t", adjusted: false, busy: true });
  });

  it("終わりなしは 30:00 まで。本人「〜30:00」と卓「21:00〜」は記号のまま", () => {
    expect(statusForWindow("o", R("20:00"), R("21:00"))).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("o", R("20:00", "30:00"), R("21:00"))).toEqual({ s: "o", adjusted: false });
  });

  it("卓の時間帯がなくても、本人の時間と重ならなければ記号のまま", () => {
    expect(statusWithBusy("o", R("10:00", "13:00"), undefined, busy)).toEqual({ s: "o", adjusted: false, busy: false });
  });

  it("本人の時間と卓の時間帯が重ならないときは、時刻不明の busy でも × のまま(△ に上げない)", () => {
    expect(statusWithBusy("o", R("10:00", "13:00"), R("21:00", "24:00"), [null])).toEqual({
      s: "x",
      adjusted: true,
      busy: false,
    });
  });

  it("時刻不明の busy は △ + 印", () => {
    expect(statusWithBusy("o", undefined, R("21:00", "24:00"), [null])).toEqual({ s: "t", adjusted: false, busy: true });
    expect(statusWithBusy("t", undefined, undefined, [null])).toEqual({ s: "t", adjusted: false, busy: true });
  });

  it("× はそのまま、印もなし", () => {
    expect(statusWithBusy("x", undefined, R("21:00"), [null])).toEqual({ s: "x", adjusted: false, busy: false });
  });

  it("未入力は未入力のまま、重なれば印だけ", () => {
    expect(statusWithBusy(null, undefined, R("21:00", "24:00"), busy)).toEqual({ s: null, adjusted: false, busy: true });
    expect(statusWithBusy(null, undefined, R("10:00", "13:00"), busy)).toEqual({ s: null, adjusted: false, busy: false });
  });

  it("接するだけなら重ならない", () => {
    expect(statusWithBusy("o", undefined, R("23:00", "26:00"), busy)).toEqual({ s: "o", adjusted: false, busy: false });
    expect(statusWithBusy("o", undefined, R("18:00", "20:00"), busy)).toEqual({ s: "o", adjusted: false, busy: false });
  });

  it("busy が本人の時間を全部覆うと ×、まん中を割ると穴をまたぐ卓は △", () => {
    expect(statusWithBusy("o", R("20:00", "23:00"), undefined, busy)).toEqual({ s: "x", adjusted: false, busy: true });
    expect(statusWithBusy("o", R("10:00", "24:00"), R("11:00", "13:00"), [R("14:00", "16:00")]).s).toBe("o");
    expect(statusWithBusy("o", R("10:00", "24:00"), R("13:00", "17:00"), [R("14:00", "16:00")]).s).toBe("t");
  });

  it("どの組み合わせでも、busy なしの結果より良くならない", () => {
    const times = [undefined, R("10:00", "13:00"), R("18:00", "24:00"), R("20:00"), R("06:00", "30:00")];
    const windows = [undefined, R("12:00", "15:00"), R("21:00"), R("19:00", "22:00"), R("20:00", "23:00")];
    const busies: (TimeRange | null)[][] = [[null], [R("20:00", "23:00")], [R("10:00", "11:00"), null], [R("06:00", "30:00")]];
    const rank = { o: 2, t: 1, x: 0 } as const;
    for (const s of ["o", "t", "x"] as Status[]) {
      for (const t of times) {
        for (const w of windows) {
          for (const b of busies) {
            const base = statusForWindow(s, t, w);
            const r = statusWithBusy(s, t, w, b);
            expect(rank[r.s!]).toBeLessThanOrEqual(rank[base.s]);
          }
        }
      }
    }
  });

  it("1日に複数の空き時間も読める(穴があれば △)", () => {
    const two = [R("10:00", "13:00"), R("18:00", "24:00")];
    expect(statusForWindow("o", two, R("19:00", "22:00"))).toEqual({ s: "o", adjusted: false });
    expect(statusForWindow("o", two, R("12:00", "19:00"))).toEqual({ s: "t", adjusted: true });
    expect(statusForWindow("o", two, R("14:00", "17:00"))).toEqual({ s: "x", adjusted: true });
    // 接する区間はつながる
    expect(statusForWindow("o", [R("18:00", "20:00"), R("20:00", "24:00")], R("19:00", "22:00")).s).toBe("o");
  });
});

describe("時刻が配列でも読める(第2段階の準備)", () => {
  const two = [R("10:00", "13:00"), R("18:00")];
  it("表示", () => {
    expect(dayTimeLabel(two)).toBe("10:00〜13:00、18:00〜");
    expect(shortDayTimeLabel(two)).toBe("10〜13 +1");
    expect(shortDayTimeLabel(R("21:00"))).toBe("21〜");
  });
  it("元に戻すの比較で、配列の違いを見分ける", () => {
    expect(sameDayTime(two, [R("10:00", "13:00"), R("18:00")])).toBe(true);
    expect(sameDayTime(two, [R("10:00", "13:00"), R("19:00")])).toBe(false);
    expect(sameDayTime(R("10:00", "13:00"), [R("10:00", "13:00")])).toBe(true);
    const h = recordChange(emptyHistory(), 1, "2026-11-03", { s: "o", time: two }, { s: "o", time: [R("10:00", "13:00")] });
    expect(h.done).toHaveLength(1);
  });
});

describe("卓ページの判定に busy を入れる", () => {
  const D = "2026-11-03";
  const person = (role: "GM" | "PL", s: Status | undefined, busy?: { s: Status | null; adjusted: boolean }): ParticipantView => ({
    id: `prt_${role}${s}`,
    role,
    displayName: role,
    calendarDeleted: false,
    availability: s ? { [D]: { s } } : {},
    ...(busy ? { busy: { [D]: busy } } : {}),
  });

  it("サーバーの結果があればそれを使う", () => {
    expect(cellStatus(person("PL", "o", { s: "t", adjusted: false }), D)).toEqual({ s: "t", adjusted: false, busy: true });
    expect(cellStatus(person("PL", "o"), D)).toEqual({ s: "o", adjusted: false, busy: false });
    expect(cellStatus(person("PL", undefined, { s: null, adjusted: false }), D)).toEqual({
      s: null,
      adjusted: false,
      busy: true,
    });
  });

  it("busy で × になった GM がいる日は開催できない日", () => {
    const r = judgeDate([person("GM", "o", { s: "x", adjusted: false }), person("PL", "o")], D);
    expect(r.judgement).toBe("ng");
    expect(r.x).toBe(1);
  });

  it("未入力 + 印の人は未入力として数える", () => {
    const r = judgeDate([person("GM", "o"), person("PL", undefined, { s: null, adjusted: false })], D);
    expect(r.judgement).toBe("ok");
    expect(r.o + r.t + r.x).toBe(1);
    expect(r.allOk).toBe(false);
  });
});

// ---- API ----

const day = (n: number) => addDays(jstNow().today, n);

async function createSession(gm: CalendarCreatedResponse, body: Record<string, unknown>): Promise<SessionResponse> {
  const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body });
  if (res.status !== 201) throw new Error(`卓の作成に失敗: ${res.status} ${await res.text()}`);
  return res.json();
}
async function joinSession(id: string, cal: CalendarCreatedResponse) {
  const res = await api("POST", `/api/sessions/${id}/participants`, { secret: cal.editSecret, body: {} });
  if (res.status !== 201) throw new Error(`参加に失敗: ${res.status}`);
}
async function patchSession(id: string, gm: CalendarCreatedResponse, body: unknown) {
  const res = await api("PATCH", `/api/sessions/${id}`, { secret: gm.editSecret, body });
  if (res.status !== 200) throw new Error(`変更に失敗: ${res.status} ${await res.text()}`);
  return res.json<SessionResponse>();
}
async function getSession(id: string): Promise<SessionResponse> {
  const res = await api("GET", `/api/sessions/${id}`);
  if (res.status !== 200) throw new Error(`取得に失敗: ${res.status}`);
  return res.json();
}
async function putAvailability(cal: CalendarCreatedResponse, availability: unknown) {
  const res = await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
  if (res.status !== 200) throw new Error(`保存に失敗: ${res.status}`);
}

/** PL が2つの卓(A と B)に参加。A は day(3) に 20:00〜23:00 で決定。B は day(3)・day(4) が候補 */
async function twoSessions() {
  const gmA = await createCalendar("GM-A");
  const gmB = await createCalendar("GM-B");
  const pl = await createCalendar("PL");
  const a = await createSession(gmA, { title: "秘密の卓A", candidateDates: [day(3), day(10)], timeWindow: R("20:00", "23:00") });
  const b = await createSession(gmB, { title: "卓B", candidateDates: [day(3), day(4)], timeWindow: R("19:00", "22:00") });
  await joinSession(a.id, pl);
  await joinSession(b.id, pl);
  await putAvailability(pl, { [day(3)]: { s: "o", time: R("18:00", "24:00") }, [day(4)]: { s: "o" } });
  await patchSession(a.id, gmA, { confirmedDates: [day(3)] });
  return { gmA, gmB, pl, a, b };
}

const plOf = (s: SessionResponse) => s.participants.find((p) => p.displayName === "PL")!;

describe("卓ページの API の busy", () => {
  it("候補日に当たるほかの卓の開催日だけ、判定した結果を返す。卓の名前・ID・時刻は入れない", async () => {
    const { a, b } = await twoSessions();
    const view = await getSession(b.id);
    expect(plOf(view).busy).toEqual({ [day(3)]: { s: "t", adjusted: false } });
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("秘密の卓A");
    expect(raw).not.toContain(a.id);
    expect(raw).not.toContain("23:00");
    // GM には busy がない
    expect(view.participants.find((p) => p.role === "GM")!.busy).toBeUndefined();
  });

  it("その卓自身の開催日は busy に入らない", async () => {
    const { a } = await twoSessions();
    expect(plOf(await getSession(a.id)).busy).toBeUndefined();
  });

  it("日ごとの時間帯が卓の時間帯より優先", async () => {
    const { gmA, a, b } = await twoSessions();
    await patchSession(a.id, gmA, { dateTimes: { [day(3)]: R("12:00", "15:00") } });
    // 12:00〜15:00 は本人の 18:00〜 とも卓B の 19:00〜 とも重ならない
    expect(plOf(await getSession(b.id)).busy).toBeUndefined();
  });

  it("時間帯のない卓で決まると △ + 印", async () => {
    const gmA = await createCalendar("GM-A");
    const gmB = await createCalendar("GM-B");
    const pl = await createCalendar("PL");
    const a = await createSession(gmA, { title: "A", candidateDates: [day(3)] });
    const b = await createSession(gmB, { title: "B", candidateDates: [day(3)] });
    await joinSession(a.id, pl);
    await joinSession(b.id, pl);
    await putAvailability(pl, { [day(3)]: { s: "o" } });
    await patchSession(a.id, gmA, { confirmedDates: [day(3)] });
    const view = await getSession(b.id);
    expect(plOf(view).busy).toEqual({ [day(3)]: { s: "t", adjusted: false } });
  });

  it("記録になったほかの卓は入れない", async () => {
    const { a, b } = await twoSessions();
    await env.DB.prepare("UPDATE sessions SET archived_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), a.id).run();
    expect(plOf(await getSession(b.id)).busy).toBeUndefined();
  });

  it("記録になった卓では計算しない", async () => {
    const { b } = await twoSessions();
    await env.DB.prepare("UPDATE sessions SET archived_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), b.id).run();
    expect(plOf(await getSession(b.id)).busy).toBeUndefined();
  });
});

describe("自分の卓一覧の confirmedTimes", () => {
  it("開催日ごとの時間帯(日ごとの時間帯が優先、なければ null)", async () => {
    const gm = await createCalendar("GM");
    const withWindow = await createSession(gm, { title: "A", candidateDates: [day(3), day(4)], timeWindow: R("20:00", "23:00") });
    await patchSession(withWindow.id, gm, { confirmedDates: [day(3), day(4)], dateTimes: { [day(4)]: R("13:00", "17:00") } });
    const noWindow = await createSession(gm, { title: "B", candidateDates: [day(6)] });
    await patchSession(noWindow.id, gm, { confirmedDates: [day(6)] });
    const res = await api("GET", `/api/calendars/${gm.id}/sessions`, { secret: gm.editSecret });
    const list = await res.json<MySessionsResponse>();
    const byTitle = Object.fromEntries(list.active.map((s) => [s.title, s.confirmedTimes]));
    expect(byTitle["A"]).toEqual({ [day(3)]: R("20:00", "23:00"), [day(4)]: R("13:00", "17:00") });
    expect(byTitle["B"]).toEqual({ [day(6)]: null });
  });
});
