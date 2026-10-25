// 回数制限(spec.md 5.8)。IP ごとに数える
import type { MiddlewareHandler } from "hono";
import { Errors } from "./errors";
import type { AppEnv } from "./types";

type LimiterName = "RL_CREATE" | "RL_TOKEN" | "RL_WRITE";

/**
 * 指定した制限をかける。
 * この仕組みは拠点ごとの「おおよその」制限なので、連打を防ぐ目的で使う
 */
export function rateLimit(name: LimiterName): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[name];
    // CF-Connecting-IP は Cloudflare が付ける本当の接続元。利用者が書き換えることはできない
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: ip });
    if (!success) throw Errors.rateLimited();
    return next();
  };
}
