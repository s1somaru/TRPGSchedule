// URLを貼ったときのカードに、卓のタイトルが入るか(spec.md 3.21)
import { addDays, jstNow } from "../src/shared/dates";
import { describe, expect, it } from "vitest";
import type { SessionResponse } from "../src/shared/types";
import { api, createCalendar } from "./helpers";

const day = (n: number) => addDays(jstNow().today, n);

async function makeSession(title: string): Promise<SessionResponse> {
  const gm = await createCalendar("GM");
  const res = await api("POST", "/api/sessions", { secret: gm.editSecret, body: { title, candidateDates: [day(3)] } });
  return res.json();
}

const meta = (html: string, attr: string) => new RegExp(`<meta ${attr} content="([^"]*)"`).exec(html)?.[1];

describe("卓ページのカード", () => {
  it("タイトル・カード・説明に、卓のタイトルが入る", async () => {
    const s = await makeSession("霧の館");
    const res = await api("GET", `/s/${s.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>たくよせ（霧の館）</title>");
    expect(meta(html, 'property="og:title"')).toBe("たくよせ（霧の館）");
    expect(meta(html, 'property="og:description"')).toContain("「霧の館」");
    expect(meta(html, 'name="description"')).toContain("「霧の館」");
    expect(meta(html, 'property="og:url"')).toBe(`https://example.com/s/${s.id}`);
  });

  it("タイトルに記号があっても、HTML として読まれない", async () => {
    const s = await makeSession(`<script>alert(1)</script> "&'`);
    const html = await (await api("GET", `/s/${s.id}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(meta(html, 'property="og:title"')).not.toContain('"');
  });

  it("画面と同じセキュリティヘッダを付け、毎回確かめてもらう", async () => {
    const s = await makeSession("ヘッダ");
    const res = await api("GET", `/s/${s.id}`);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("ない卓・形の違うURLでは、ふつうの画面を返す(タイトルは入れない)", async () => {
    for (const path of ["/s/ses_AAAAAAAAAAAAAAAAAAAAAA", "/s/abc", "/s/abc/def"]) {
      const res = await api("GET", path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html, path).toContain("<title>たくよせ | TRPGの日程調整</title>");
      expect(res.headers.get("Content-Security-Policy"), path).toContain("default-src 'self'");
    }
  });
});
