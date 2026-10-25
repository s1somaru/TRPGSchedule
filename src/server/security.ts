// API 全体にかけるセキュリティの処理(spec.md 7.3 / 7.5 / 5.1)
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Errors } from "./errors";

const MAX_BODY_BYTES = 32 * 1024;

// 画面側(public/_headers)と同じヘッダを API にも付ける
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // 秘密を扱うので、途中で保存(キャッシュ)させない
  "Cache-Control": "no-store",
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** ヘッダを付ける。エラーの応答にも付くように、後処理でまとめて付ける */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
};

/**
 * 書き込みのリクエストを確かめる
 * - 別のサイトから送られたもの(Origin が違う)は断る(CSRF 対策)
 * - ボディがあるなら JSON に限る(フォームの送信では送れないようにする)
 */
export const writeGuard: MiddlewareHandler = async (c, next) => {
  if (READ_METHODS.has(c.req.method)) return next();

  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    throw Errors.forbidden("別のサイトからの操作は受け付けていません");
  }

  const length = c.req.header("Content-Length");
  const hasBody = length !== undefined ? Number(length) > 0 : c.req.raw.body !== null;
  if (hasBody) {
    const type = c.req.header("Content-Type") ?? "";
    if (!/^application\/json(\s*;|$)/i.test(type)) throw Errors.unsupportedMediaType();
  }
  return next();
};

/** ボディの大きさの上限 */
export const sizeLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: () => {
    throw Errors.payloadTooLarge();
  },
});
