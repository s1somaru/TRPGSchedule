// 回数制限の数え方のテスト
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
