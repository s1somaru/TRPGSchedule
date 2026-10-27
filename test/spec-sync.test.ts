// 仕様書(spec.md)に合わせた動きの確認
import { describe, expect, it } from "vitest";
import { addDays, jstNow } from "../src/shared/dates";
import type { CalendarResponse, SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

describe("最終更新(lastUpdatedAt)は、本当に変わったときだけ進む(3.13)", () => {
  it("同じ予定・同じ名前を送り直しても進まない。違えば進む", async () => {
    const cal = await createCalendar("たろう");
    const put = async (availability: Record<string, unknown>) =>
      (await (await api("PUT", `/api/calendars/${cal.id}/availability`, { secret: cal.editSecret, body: { availability } })).json()) as CalendarResponse;
    const patch = async (body: Record<string, unknown>) =>
      (await (await api("PATCH", `/api/calendars/${cal.id}`, { secret: cal.editSecret, body })).json()) as CalendarResponse;
    const wait = () => new Promise((r) => setTimeout(r, 5));

    const first = await put({ [day(3)]: { s: "o", memo: "メモ" } });
    await wait();
    expect((await put({ [day(3)]: { s: "o", memo: "メモ" } })).lastUpdatedAt).toBe(first.lastUpdatedAt);
    await wait();
    const changed = await put({ [day(3)]: { s: "t", memo: "メモ" } });
    expect(changed.lastUpdatedAt > first.lastUpdatedAt).toBe(true);

    await wait();
    expect((await patch({ displayName: "たろう" })).lastUpdatedAt).toBe(changed.lastUpdatedAt);
    await wait();
    expect((await patch({ displayName: "じろう" })).lastUpdatedAt > changed.lastUpdatedAt).toBe(true);
  });
});

describe("日ごとの時間帯は、卓の時間帯と違う日だけ持つ(3.18)", () => {
  it("卓の時間帯を変えて同じになった日の分は、自動で消える", async () => {
    const gm = await createCalendar("GM");
    const created = await api("POST", "/api/sessions", {
      secret: gm.editSecret,
      body: { title: "卓", candidateDates: [day(3), day(4)], timeWindow: { from: "21:00" } },
    });
    const s = (await created.json()) as SessionResponse;
    const patch = async (body: Record<string, unknown>) =>
      (await (await api("PATCH", `/api/sessions/${s.id}`, { secret: gm.editSecret, body })).json()) as SessionResponse;

    let after = await patch({ dateTimes: { [day(3)]: { from: "20:00" }, [day(4)]: { from: "21:00" } } });
    // 卓の時間帯と同じ日(day(4))は持たない
    expect(after.dateTimes).toEqual({ [day(3)]: { from: "20:00" } });
    // 卓の時間帯を 20:00 に変えると、day(3) の分も同じになるので消える
    after = await patch({ timeWindow: { from: "20:00" } });
    expect(after.dateTimes).toEqual({});
  });
});
