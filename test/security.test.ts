// セキュリティまわりのテスト(spec.md 7章)
// 画面のファイルのヘッダ・https への切り替え・API の共通の応答・500 のエラー・画面のコード・書き込みの確認(writeGuard)・伏せ字
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleError, redact } from "../src/server/errors";
import { PAGE_SECURITY_HEADERS } from "../src/server/share-card";
import { newSecret } from "../src/shared/ids";
import headersFile from "../public/_headers?raw";
import { api, createCalendar } from "./helpers";

/** _headers の「/*」の下に書かれたヘッダを読み取る */
function staticHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of headersFile.split(/\r?\n/)) {
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m) out[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return out;
}

describe("画面のファイルに付けるヘッダ(public/_headers)", () => {
  it("CSP に必要な指定がすべて入っている", () => {
    const csp = staticHeaders()["content-security-policy"];
    expect(csp).toBeDefined();
    const directives = csp!.split(";").map((d) => d.trim());
    for (const d of [
      "default-src 'self'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "require-trusted-types-for 'script'",
    ]) {
      expect(directives).toContain(d);
    }
    // 外から読み込んだスクリプトや、文字列からのスクリプト実行は許していない
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("ほかのセキュリティヘッダも付く", () => {
    const h = staticHeaders();
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["strict-transport-security"]).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(h["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("卓ページのヘッダ(PAGE_SECURITY_HEADERS)は public/_headers と同じ", () => {
    const expected = Object.fromEntries(Object.entries(PAGE_SECURITY_HEADERS).map(([name, value]) => [name.toLowerCase(), value]));
    expect(staticHeaders()).toEqual(expected);
  });
});

/** URL をそのまま指定して Worker を呼ぶ(api() は https://example.com 固定なので) */
function fetchUrl(url: string, init: RequestInit = {}): Promise<Response> {
  const worker = (exports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;
  return worker.fetch(new Request(url, { redirect: "manual", ...init }));
}

describe("http で来たら https に飛ばす(7.5)", () => {
  it("画面のページは、同じ場所の https に 308 で飛ばす(パスとクエリはそのまま)", async () => {
    for (const path of ["/", "/new", "/c/cal_x", "/s/ses_x?from=share", "/terms"]) {
      const res = await fetchUrl(`http://example.com${path}`);
      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe(`https://example.com${path}`);
    }
  });

  it("API も https に飛ばし、中身は処理しない(カレンダーは作られない)", async () => {
    const res = await fetchUrl("http://example.com/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.9.9.9" },
      body: JSON.stringify({ displayName: "http" }),
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.com/api/calendars");
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM calendars WHERE display_name = ?1").bind("http").first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("手元の開発環境(localhost・127.0.0.1)の http は、そのまま開ける", async () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      const res = await fetchUrl(`http://${host}/`);
      expect(res.status).toBe(200);
    }
  });

  it("https のページは、画面のファイルと同じヘッダを付けて返す", async () => {
    const res = await fetchUrl("https://example.com/new");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });

  it("知らない API は、画面のファイルではなく 404 の JSON になる(GET 以外も)", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await api(method, "/api/nothing", method === "POST" ? { body: {} } : {});
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toContain("application/json");
    }
  });
});

describe("サーバーの中のエラー(500)", () => {
  afterEach(() => vi.restoreAllMocks());

  const SECRET = `sec_${"Z".repeat(43)}`;
  function failingApp() {
    const app = new Hono();
    app.get("/boom", () => {
      throw new Error(`D1_ERROR: SELECT id FROM calendars WHERE edit_secret_hash = '${SECRET}'`);
    });
    app.onError(handleError);
    return app;
  }

  it("応答には決まった文だけを返し、SQL や秘密は入れない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await failingApp().request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "サーバーで問題が起きました。時間をおいてお試しください" },
    });
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain(SECRET);
  });

  it("ログにはエラーの種類と場所が残る", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await failingApp().request("/boom");
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, string>;
    expect(logged).toMatchObject({ code: "INTERNAL_ERROR", route: "/boom", name: "Error" });
  });

  // 以前は err.message をそのままログに出していたため、秘密が残ることがあった(2026-10-26 に伏せ字にして修正)
  it("エラーの文に秘密らしい値が入っていても、ログには出さない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await failingApp().request("/boom");
    const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(SECRET);
  });
});

describe("画面のコードに危ない書き方がない", () => {
  const sources = import.meta.glob<string>("../src/client/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

  it("画面のファイルを読めている", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it("HTML を文字列から作る書き方・文字列からのコード実行を使っていない", () => {
    const banned = [/dangerouslySetInnerHTML/, /\binnerHTML\b/, /\bouterHTML\b/, /document\.write/, /\beval\s*\(/, /new\s+Function\b/];
    const found: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const re of banned) if (re.test(text)) found.push(`${file}: ${re.source}`);
    }
    expect(found).toEqual([]);
  });
});

describe("API の共通の応答", () => {
  it("API の応答にセキュリティヘッダが付く(エラーのときも)", async () => {
    for (const res of [
      await api("POST", "/api/calendars", { body: { displayName: "a" } }),
      await api("GET", "/api/calendars/cal_x"),
      await api("GET", "/api/nothing"),
    ]) {
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("32KB を超えるボディは 413", async () => {
    const res = await api("POST", "/api/calendars", {
      rawBody: JSON.stringify({ displayName: "a".repeat(40_000) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(413);
  });

  it("知らない API は 404 の JSON", async () => {
    const res = await api("GET", "/api/nothing");
    expect(res.status).toBe(404);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("NOT_FOUND");
  });
});

describe("書き込みのリクエストの確認(writeGuard)", () => {
  it("application/json; charset=utf-8 は受け付ける", async () => {
    const res = await api("POST", "/api/calendars", {
      body: { displayName: "a" },
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    expect(res.status).toBe(201);
  });

  it("text/json は 415", async () => {
    const res = await api("POST", "/api/calendars", {
      rawBody: JSON.stringify({ displayName: "a" }),
      headers: { "Content-Type": "text/json" },
    });
    expect(res.status).toBe(415);
  });

  it("Origin: null(サンドボックスなど)からの書き込みは 403", async () => {
    const res = await api("POST", "/api/calendars", { body: { displayName: "a" }, headers: { Origin: "null" } });
    expect(res.status).toBe(403);
  });

  it("別のサイトからの PUT と DELETE も 403。カレンダーは消えない", async () => {
    const cal = await createCalendar();
    const put = await api("PUT", `/api/calendars/${cal.id}/availability`, {
      secret: cal.editSecret,
      body: { availability: {} },
      headers: { Origin: "https://evil.example" },
    });
    expect(put.status).toBe(403);
    const del = await api("DELETE", `/api/calendars/${cal.id}`, {
      secret: cal.editSecret,
      headers: { Origin: "https://evil.example" },
    });
    expect(del.status).toBe(403);
    expect((await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret })).status).toBe(200);
  });

  it("別のサイトからの書き込みは 403", async () => {
    const res = await api("POST", "/api/calendars", {
      body: { displayName: "a" },
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("同じサイトからの書き込みは通る", async () => {
    const res = await api("POST", "/api/calendars", {
      body: { displayName: "a" },
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(201);
  });

  it("JSON 以外の形式は 415(フォーム送信を防ぐ)", async () => {
    const res = await api("POST", "/api/calendars", {
      rawBody: "displayName=a",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });

  it("Sec-Fetch-Site が cross-site / same-site なら 403。same-origin と、付いていないときは通す", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const res = await api("POST", "/api/calendars", { body: { displayName: "x" }, headers: { "Sec-Fetch-Site": site } });
      expect(res.status, site).toBe(403);
    }
    const cases: Record<string, string>[] = [{ "Sec-Fetch-Site": "same-origin" }, {}];
    for (const headers of cases) {
      const res = await api("POST", "/api/calendars", { body: { displayName: "x" }, headers });
      expect(res.status).toBe(201);
    }
  });

  it("読むだけのリクエストは、Sec-Fetch-Site に関係なく通す", async () => {
    const cal = await createCalendar();
    const res = await api("GET", `/api/calendars/${cal.id}`, { secret: cal.editSecret, headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(200);
  });
});

describe("伏せ字", () => {
  it("前に記号や英字が付いていても、IDと秘密を伏せる", () => {
    const secret = newSecret();
    expect(redact(`x_${secret}`)).not.toContain(secret.slice(4));
    expect(redact(`A${secret}`)).not.toContain(secret.slice(4));
    expect(redact(`URL:https://example.com/c/cal_abcdefghijklmnopqrstuv#${secret}`)).toBe(
      "URL:https://example.com/c/cal_***#sec_***",
    );
  });

  it("お問い合わせに書かれた編集URLは、伏せてから保存する", async () => {
    const secret = newSecret();
    const res = await api("POST", "/api/feedback", {
      body: { kind: "contact", category: "bug", message: `開けません https://x/c/cal_abcdefghijklmnopqrstuv#${secret}`, contact: `${secret}` },
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT message, contact FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT 1").first<{
      message: string;
      contact: string;
    }>();
    expect(row!.message).not.toContain(secret.slice(4));
    expect(row!.message).toContain("sec_***");
    expect(row!.contact).toBe("sec_***");
  });
});
