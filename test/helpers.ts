// テスト用の便利な関数
import { exports } from "cloudflare:workers";
import type { CalendarCreatedResponse } from "../src/shared/types";

let ipCounter = 0;
/** 回数制限に引っかからないよう、テストごとに別の接続元に見せる */
export function freshIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface ApiOptions {
  body?: unknown;
  rawBody?: string;
  secret?: string;
  headers?: Record<string, string>;
  ip?: string;
}

/** API を呼ぶ */
export function api(method: string, path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "CF-Connecting-IP": opts.ip ?? freshIp(),
    ...(opts.secret ? { Authorization: `Bearer ${opts.secret}` } : {}),
  };
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  Object.assign(headers, opts.headers);
  const worker = (exports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;
  return worker.fetch(new Request(`https://example.com${path}`, { method, headers, body }));
}

/** カレンダーを1つ作る */
export async function createCalendar(displayName = "たろう"): Promise<CalendarCreatedResponse> {
  const res = await api("POST", "/api/calendars", { body: { displayName } });
  if (res.status !== 201) throw new Error(`作成に失敗: ${res.status} ${await res.text()}`);
  return res.json();
}
