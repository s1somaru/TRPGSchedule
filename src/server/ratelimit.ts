// 回数制限(spec.md 5.8)。接続元ごとに数える
import type { MiddlewareHandler } from "hono";
import { Errors } from "./errors";
import type { AppEnv } from "./types";

type LimiterName = "RL_CREATE" | "RL_WRITE" | "RL_READ";

/**
 * 数える単位を決める。
 * - IPv4 はアドレス1つごと
 * - IPv6 は先頭64ビットごと。IPv6 の回線は普通、とても多くのアドレスを持っていて
 *   1つずつ変えられるので、アドレスごとに数えると制限がきかないため
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  // IPv4 を IPv6 の形で書いたもの(::ffff:1.2.3.4)は、IPv4 のアドレスとして数える
  const mapped = /^::ffff:(d{1,3}(?:.d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  // "::" で省略された部分を 0 で埋めて、先頭の4つの区切り(64ビット)を取り出す
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const zeros = ip.includes("::") ? Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0") : [];
  const parts = [...headParts, ...zeros, ...tailParts];
  return parts
    .slice(0, 4)
    .map((p) => p.replace(/^0+(?=.)/, ""))
    .join(":") + "::/64";
}

/**
 * 指定した制限をかける。
 * この仕組みは拠点ごとの「おおよその」制限なので、連打を防ぐ目的で使う
 */
export function rateLimit(name: LimiterName): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[name];
    // CF-Connecting-IP は Cloudflare が付ける本当の接続元。利用者が書き換えることはできない
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: rateLimitKey(ip) });
    if (!success) throw Errors.rateLimited();
    return next();
  };
}
