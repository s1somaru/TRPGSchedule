// 回数制限のテスト(spec.md 5.8)
// 数える単位(IPv4 / IPv6)・接続元のヘッダがない場合・書き込みと読み取りの上限・作成の上限(3つで1つの枠)
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { rateLimitKey } from "../src/server/ratelimit";
import { addDays, jstNow } from "../src/shared/dates";
import { api, createCalendar, freshIp } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

describe("回数制限の数える単位", () => {
  it("IPv4 はアドレスそのもの", () => {
    expect(rateLimitKey("203.0.113.5")).toBe("203.0.113.5");
  });

  it("IPv6 は先頭64ビット", () => {
    expect(rateLimitKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(rateLimitKey("2001:DB8:1:2:ffff::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("2001:0db8:0001:0002::")).toBe("2001:db8:1:2::/64");
  });

  it("同じ回線の違うアドレスは、同じ単位になる", () => {
    expect(rateLimitKey("2001:db8:aa:bb::1")).toBe(rateLimitKey("2001:db8:aa:bb:ffff:ffff:ffff:ffff"));
  });
});

describe("回数制限の数える単位(特別な書き方)", () => {
  it("IPv4 を IPv6 の形で書いたもの(::ffff:1.2.3.4)は IPv4 として数える", () => {
    expect(rateLimitKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(rateLimitKey("::FFFF:203.0.113.5")).toBe("203.0.113.5");
    // 数字と「.」の形でないものは IPv4 として扱わない(正規表現の \d と \. が正しく効いているか)
    expect(rateLimitKey("::ffff:1x2x3x4")).not.toBe("1x2x3x4");
    expect(rateLimitKey("::ffff:d.d.d.d")).not.toBe("d.d.d.d");
  });

  it("::1 と :: は先頭64ビットが全部0", () => {
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("::")).toBe("0:0:0:0::/64");
  });
});

describe("接続元のヘッダがない場合", () => {
  it("CF-Connecting-IP がなくても、エラーにならずに動く", async () => {
    const worker = (exports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;
    const res = await worker.fetch(
      new Request("https://example.com/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "ヘッダなし" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("回数制限(書き込み・読み取り)", () => {
  it("書き込みは同じ接続元から1分に60回まで", async () => {
    const cal = await createCalendar();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await api("PUT", `/api/calendars/${cal.id}/availability`, {
        secret: cal.editSecret,
        ip,
        body: { availability: { [day(1)]: { s: "o" } } },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("読み取りは同じ接続元から1分に120回まで", async () => {
    const cal = await createCalendar();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) {
      statuses.push((await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret, ip })).status);
    }
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
  });

  it("IPv6 は先頭64ビットが同じなら、同じ接続元として数える", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // 末尾だけ違う(同じ回線の)アドレス
      const ip = `2001:db8:aa:bb::${(i + 1).toString(16)}`;
      statuses.push((await api("POST", "/api/calendars", { body: { displayName: "a" }, ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("作成の回数制限(3つで1つの枠)", () => {
  it("カレンダー・卓・問い合わせの作成は、合わせて1分に10回まで", async () => {
    // 卓を作るための秘密は、別の接続元で用意しておく
    const gm = await createCalendar("GM");
    const ip = freshIp();
    const createCal = () => api("POST", "/api/calendars", { body: { displayName: "a" }, ip });
    const createSession = () =>
      api("POST", "/api/sessions", { secret: gm.editSecret, body: { title: "卓", candidateDates: [day(3)] }, ip });
    const sendFeedback = () => api("POST", "/api/feedback", { body: { kind: "rating", rating: 5 }, ip });

    // カレンダー4回 + 卓3回 + 問い合わせ3回 = 10回。どれも止められない
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await createCal()).status);
    for (let i = 0; i < 3; i++) statuses.push((await createSession()).status);
    for (let i = 0; i < 3; i++) statuses.push((await sendFeedback()).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 201, 201, 201, 201]);

    // 11回目からは、どの種類でも 429
    expect((await createCal()).status).toBe(429);
    expect((await createSession()).status).toBe(429);
    expect((await sendFeedback()).status).toBe(429);
  });
});
