// 回数制限の数え方のテスト
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { rateLimitKey } from "../src/server/ratelimit";

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
