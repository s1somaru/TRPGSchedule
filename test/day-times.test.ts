// 1日に複数の空いている時間(design/busy-and-multi-times.md 3)
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { addDays, jstNow } from "../src/shared/dates";
import { DayTimeSchema, TimeRangeSchema } from "../src/shared/schema";
import { normalizeDayTime } from "../src/shared/time";
import type { CalendarCreatedResponse, CalendarResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

describe("normalizeDayTime", () => {
  it("始まり順に並べ、重なる・接する区間をまとめる", () => {
    expect(
      normalizeDayTime([
        { from: "19:00", to: "22:00" },
        { from: "10:00", to: "13:00" },
      ]),
    ).toEqual([
      { from: "10:00", to: "13:00" },
      { from: "19:00", to: "22:00" },
    ]);
    expect(
      normalizeDayTime([
        { from: "10:00", to: "13:00" },
        { from: "13:00", to: "15:00" },
        { from: "12:00", to: "14:00" },
      ]),
    ).toEqual({ from: "10:00", to: "15:00" });
  });

  it("終わりなしを含むまとまりは終わりなしのまま。明示の 30:00 だけなら残す", () => {
    expect(normalizeDayTime([{ from: "19:00", to: "22:00" }, { from: "10:00" }])).toEqual({ from: "10:00" });
    expect(normalizeDayTime([{ from: "20:00" }, { from: "22:00", to: "30:00" }])).toEqual({ from: "20:00" });
    expect(
      normalizeDayTime([
        { from: "10:00", to: "12:00" },
        { from: "22:00", to: "30:00" },
      ]),
    ).toEqual([
      { from: "10:00", to: "12:00" },
      { from: "22:00", to: "30:00" },
    ]);
  });

  it("1つになった結果は、今の1区間と同じ JSON。2回通しても変わらない", () => {
    const one = normalizeDayTime([{ from: "21:00", to: "25:00" }]);
    expect(JSON.stringify(one)).toBe(JSON.stringify(v.parse(TimeRangeSchema, { to: "25:00", from: "21:00" })));
    const many = normalizeDayTime([
      { from: "19:00", to: "22:00" },
      { from: "10:00" },
      { from: "08:00", to: "09:00" },
    ]);
    expect(normalizeDayTime(many)).toEqual(many);
  });

  it("スキーマ:オブジェクトはそのまま、配列は1〜3個", () => {
    expect(v.parse(DayTimeSchema, { from: "21:00" })).toEqual({ from: "21:00" });
    expect(v.safeParse(DayTimeSchema, []).success).toBe(false);
    const four = ["08:00", "11:00", "14:00", "17:00"].map((from) => ({ from, to: `${Number(from.slice(0, 2)) + 1}:00` }));
    expect(v.safeParse(DayTimeSchema, four).success).toBe(false);
  });
});

function putAvailability(cal: CalendarCreatedResponse, availability: unknown) {
  return api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } });
}

async function getCalendar(cal: CalendarCreatedResponse): Promise<CalendarResponse> {
  const res = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret });
  return res.json();
}

describe("複数の空いている時間の API", () => {
  it("配列はまとめた形で保存され、同じものを送り直しても最終更新は進まない", async () => {
    const cal = await createCalendar();
    const sent = [
      { from: "19:00", to: "22:00" },
      { from: "10:00", to: "13:00" },
    ];
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: sent } })).status).toBe(200);
    const first = await getCalendar(cal);
    expect(first.availability[day(1)]).toEqual({
      s: "o",
      time: [
        { from: "10:00", to: "13:00" },
        { from: "19:00", to: "22:00" },
      ],
    });
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: sent } })).status).toBe(200);
    expect((await getCalendar(cal)).lastUpdatedAt).toBe(first.lastUpdatedAt);
  });

  it("0個・4個・使えない時刻は 422。× の日は配列も捨てる", async () => {
    const cal = await createCalendar();
    const four = ["08:00", "11:00", "14:00", "17:00"].map((from) => ({ from }));
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: [] } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: four } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "o", time: [{ from: "21:15" }] } })).status).toBe(422);
    expect((await putAvailability(cal, { [day(1)]: { s: "x", time: [{ from: "10:00", to: "12:00" }, { from: "20:00" }] } })).status).toBe(200);
    expect((await getCalendar(cal)).availability[day(1)]).toEqual({ s: "x" });
  });

  it("いつもの時間は配列も受け付け、卓の時間帯は配列を受け付けない", async () => {
    const cal = await createCalendar();
    const res = await api("PATCH", `/api/calendars/${cal.id}`, {
      secret: cal.editSecret,
      body: { weeklyTimes: { "6": [{ from: "20:00" }, { from: "10:00", to: "12:00" }] } },
    });
    expect(res.status).toBe(200);
    expect((await getCalendar(cal)).weeklyTimes).toEqual({ "6": [{ from: "10:00", to: "12:00" }, { from: "20:00" }] });

    const created = await api("POST", "/api/sessions", {
      secret: cal.editSecret,
      body: { title: "卓", candidateDates: [day(3)], timeWindow: [{ from: "20:00" }] },
    });
    expect([400, 422]).toContain(created.status);
    const ok = await api("POST", "/api/sessions", { secret: cal.editSecret, body: { title: "卓", candidateDates: [day(3)] } });
    const s = await ok.json<{ id: string }>();
    const patched = await api("PATCH", `/api/sessions/${s.id}`, {
      secret: cal.editSecret,
      body: { dateTimes: { [day(3)]: [{ from: "20:00" }] } },
    });
    expect([400, 422]).toContain(patched.status);
  });
});
