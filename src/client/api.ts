// API を呼ぶための関数。秘密は Authorization ヘッダでだけ送る(URL には入れない)
import type {
  Availability,
  CalendarCreatedResponse,
  CalendarResponse,
  DayEntry,
  MySessionsResponse,
} from "../shared/types";

/** API がエラーを返したとき */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const NETWORK_ERROR = "通信できませんでした。電波の良いところでもう一度お試しください";

async function request<T>(
  method: string,
  path: string,
  opts: { secret?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.secret) headers.Authorization = `Bearer ${opts.secret}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      keepalive: opts.keepalive,
      credentials: "omit",
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", NETWORK_ERROR);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiClientError(res.status, e?.code ?? "UNKNOWN", e?.message ?? NETWORK_ERROR, e?.details);
  }
  return data as T;
}

export const api = {
  createCalendar: (displayName: string) =>
    request<CalendarCreatedResponse>("POST", "/calendars", { body: { displayName } }),

  getCalendar: (id: string, secret: string) =>
    request<CalendarResponse>("GET", `/calendars/${id}`, { secret }),

  renameCalendar: (id: string, secret: string, displayName: string) =>
    request<CalendarResponse>("PATCH", `/calendars/${id}`, { secret, body: { displayName } }),

  putAvailability: (
    id: string,
    secret: string,
    availability: Record<string, DayEntry | null>,
    keepalive = false,
  ) =>
    request<CalendarResponse>("PUT", `/calendars/${id}/availability`, {
      secret,
      body: { availability },
      keepalive,
    }),

  deleteCalendar: (id: string, secret: string) =>
    request<void>("DELETE", `/calendars/${id}`, { secret }),

  reissueSecret: (id: string, oldSecret: string, newSecret: string) =>
    request<{ ok: true }>("POST", `/calendars/${id}/edit-secret`, {
      secret: oldSecret,
      body: { newSecret },
    }),

  mySessions: (id: string, secret: string) =>
    request<MySessionsResponse>("GET", `/calendars/${id}/sessions`, { secret }),
};

export type { Availability };
