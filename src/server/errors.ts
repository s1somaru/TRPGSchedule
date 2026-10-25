// エラーの形をそろえる(spec.md 5.1 / 5.4)
import type { Context } from "hono";
import * as v from "valibot";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// よく使うエラー。message はそのまま画面に出せる文にする
export const Errors = {
  invalidRequest: () => new ApiError(400, "INVALID_REQUEST", "送られたデータの形が正しくありません"),
  unauthorized: () =>
    new ApiError(401, "UNAUTHORIZED", "編集URLが正しくないか、使えなくなっています"),
  shareTokenInvalid: () =>
    new ApiError(401, "SHARE_TOKEN_INVALID", "参加用のトークンが正しくないか、期限が切れています"),
  forbidden: (message = "この操作はできません") => new ApiError(403, "FORBIDDEN", message),
  notFound: () => new ApiError(404, "NOT_FOUND", "見つかりませんでした"),
  payloadTooLarge: () => new ApiError(413, "PAYLOAD_TOO_LARGE", "送られたデータが大きすぎます"),
  unsupportedMediaType: () =>
    new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "データは JSON で送ってください"),
  validation: (message: string) => new ApiError(422, "VALIDATION_FAILED", message),
  rateLimited: () =>
    new ApiError(429, "RATE_LIMITED", "操作が多すぎます。少し待ってからもう一度お試しください"),
};

/**
 * リクエストのボディを読んで、入力チェックを通す。
 * 形が違えば 400、文字数などの制限に引っかかれば 422
 */
export async function readBody<S extends v.GenericSchema>(
  c: Context,
  schema: S,
): Promise<v.InferOutput<S>> {
  const text = await c.req.text();
  let data: unknown = {};
  if (text.trim() !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      throw Errors.invalidRequest();
    }
  }
  const result = v.safeParse(schema, data);
  if (result.success) return result.output;
  const issue = result.issues[0];
  // kind が "schema" のときは型や項目の違い(形の問題)、それ以外は値の制限違反
  if (issue.kind === "schema") throw Errors.invalidRequest();
  throw Errors.validation(issue.message);
}

/** すべてのエラーを決まった形の JSON にする。内部の情報は返さない */
export function handleError(err: unknown, c: Context): Response {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      err.status,
    );
  }
  // ログには場所(ID を含まない形)とエラーの種類だけを残す。ボディや秘密は出さない
  const name = err instanceof Error ? err.name : "UnknownError";
  const message = err instanceof Error ? err.message.slice(0, 200) : "";
  console.error(JSON.stringify({ code: "INTERNAL_ERROR", route: c.req.routePath, name, message }));
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "サーバーで問題が起きました。時間をおいてお試しください" } },
    500,
  );
}
